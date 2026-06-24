/* Owner-only team mutations: change role, deactivate, reactivate, resend invite,
   cancel pending invite. OWNER is re-verified server-side on every call. Guards:
   no acting on yourself for role/deactivate, never drop below one Owner (no
   lockout), deactivate (ban) instead of hard-delete, cancel only un-accepted
   invites. Service-role key server-side only. */
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { siteUrl } from '@/lib/site';
import { inviteEmailHtml, inviteEmailText, resetEmailHtml, resetEmailText } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BAN_FOREVER = '876600h'; // ~100 years
const ROLES = ['admin', 'manager', 'owner'];

async function ownerCount(admin: SupabaseClient): Promise<number> {
  const { count } = await admin.from('user_roles').select('user_id', { count: 'exact', head: true }).eq('is_owner', true);
  return count ?? 0;
}

export async function POST(req: NextRequest) {
  const SITE_URL = siteUrl(req);
  const EMAIL_FROM = process.env.EMAIL_FROM!;

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return NextResponse.json({ error: 'Missing or malformed Authorization header' }, { status: 401 });
  const accessToken = authHeader.slice(7);

  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  const callerId = userData.user.id;

  const { data: caller } = await admin.from('user_roles').select('is_owner').eq('user_id', callerId).maybeSingle();
  if (!caller?.is_owner) return NextResponse.json({ error: 'Only an Owner can manage the team' }, { status: 403 });

  let body: { action?: string; targetUserId?: string; role?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const action = String(body.action || '');
  const targetId = String(body.targetUserId || '').trim();
  if (!targetId) return NextResponse.json({ error: 'targetUserId is required' }, { status: 400 });

  const { data: target } = await admin.from('user_roles').select('user_id, role, department, full_name, is_owner').eq('user_id', targetId).maybeSingle();
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (action === 'role') {
    const roleInput = String(body.role || '').toLowerCase();
    if (!ROLES.includes(roleInput)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    if (targetId === callerId) return NextResponse.json({ error: "You can't change your own role." }, { status: 403 });
    const newIsOwner = roleInput === 'owner';
    // Never leave zero Owners.
    if (target.is_owner && !newIsOwner && (await ownerCount(admin)) <= 1) {
      return NextResponse.json({ error: 'There must be at least one Owner.' }, { status: 403 });
    }
    const { error } = await admin.from('user_roles').update({ role: roleInput === 'owner' ? 'admin' : roleInput, is_owner: newIsOwner }).eq('user_id', targetId);
    if (error) return NextResponse.json({ error: 'Update failed: ' + error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === 'deactivate') {
    if (targetId === callerId) return NextResponse.json({ error: "You can't deactivate yourself." }, { status: 403 });
    if (target.is_owner && (await ownerCount(admin)) <= 1) return NextResponse.json({ error: 'There must be at least one Owner.' }, { status: 403 });
    const { error } = await admin.auth.admin.updateUserById(targetId, { ban_duration: BAN_FOREVER });
    if (error) return NextResponse.json({ error: 'Deactivate failed: ' + error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === 'reactivate') {
    const { error } = await admin.auth.admin.updateUserById(targetId, { ban_duration: 'none' });
    if (error) return NextResponse.json({ error: 'Reactivate failed: ' + error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === 'reset') {
    // Owner-initiated password reset for an existing (accepted) member.
    const { data: au } = await admin.auth.admin.getUserById(targetId);
    const email = au?.user?.email;
    if (!email) return NextResponse.json({ error: 'User has no email on file' }, { status: 400 });
    const { data: gen, error: genErr } = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: `${SITE_URL}/set-password` } });
    const link = gen?.properties?.action_link || '';
    if (genErr || !link) return NextResponse.json({ error: 'Could not generate the reset link' }, { status: 500 });
    let emailed = false;
    try {
      if (process.env.SENDGRID_API_KEY) {
        const sg = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personalizations: [{ to: [{ email, name: target.full_name }] }],
            from: { email: EMAIL_FROM, name: 'HDS IT Helpdesk' },
            subject: 'Your HDS IT Helpdesk password was reset',
            content: [
              { type: 'text/plain', value: resetEmailText({ name: String(target.full_name), link, byOwner: true }) },
              { type: 'text/html', value: resetEmailHtml({ name: String(target.full_name), link, byOwner: true }) },
            ],
          }),
        });
        emailed = sg.ok;
      }
    } catch (err) { console.error('team/manage reset: email failed', (err as Error).message); }
    return NextResponse.json({ ok: true, emailed });
  }

  if (action === 'resend' || action === 'cancel') {
    const { data: au } = await admin.auth.admin.getUserById(targetId);
    const email = au?.user?.email;
    const confirmed = !!(au?.user?.email_confirmed_at || (au?.user as { confirmed_at?: string } | undefined)?.confirmed_at);
    if (!email) return NextResponse.json({ error: 'User has no email on file' }, { status: 400 });
    if (confirmed) return NextResponse.json({ error: 'This user has already accepted. Use deactivate instead.' }, { status: 400 });

    if (action === 'cancel') {
      if (targetId === callerId) return NextResponse.json({ error: "You can't cancel yourself." }, { status: 403 });
      await admin.from('user_roles').delete().eq('user_id', targetId);
      const { error } = await admin.auth.admin.deleteUser(targetId);
      if (error) return NextResponse.json({ error: 'Cancel failed: ' + error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // resend: regenerate a set-password link for the existing (unaccepted) user.
    const { data: gen, error: genErr } = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: `${SITE_URL}/set-password` } });
    const link = gen?.properties?.action_link || '';
    if (genErr || !link) return NextResponse.json({ error: 'Could not regenerate the invite link' }, { status: 500 });
    const roleLabel = target.is_owner ? 'owner' : String(target.role);
    let emailed = false;
    try {
      if (process.env.SENDGRID_API_KEY) {
        const sg = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personalizations: [{ to: [{ email, name: target.full_name }] }],
            from: { email: EMAIL_FROM, name: 'HDS IT Helpdesk' },
            subject: 'Your HDS IT Helpdesk invite',
            content: [
              { type: 'text/plain', value: inviteEmailText({ name: String(target.full_name), roleLabel, link }) },
              { type: 'text/html', value: inviteEmailHtml({ name: String(target.full_name), roleLabel, link }) },
            ],
          }),
        });
        emailed = sg.ok;
      }
    } catch (err) { console.error('team/manage resend: email failed', (err as Error).message); }
    return NextResponse.json({ ok: true, emailed });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
