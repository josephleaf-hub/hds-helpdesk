/* Invite a new team member. OWNER ONLY (re-checked server-side). Creates the auth
   user via the admin API and generates an invite link WITHOUT sending Supabase's
   own email, creates their user_roles row (Invited until they set a password),
   then sends a branded HDS invite via SendGrid. We never set or see a password.
   The service-role key is used server-side only. */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { siteUrl } from '@/lib/site';
import { inviteEmailHtml, inviteEmailText } from '@/lib/email';
import { ALLOWED_DOMAINS } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLES = ['admin', 'manager', 'owner'];

export async function POST(req: NextRequest) {
  const SITE_URL = siteUrl(req);
  const EMAIL_FROM = process.env.EMAIL_FROM!;

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return NextResponse.json({ error: 'Missing or malformed Authorization header' }, { status: 401 });
  const accessToken = authHeader.slice(7);

  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  const { data: caller } = await admin.from('user_roles').select('is_owner').eq('user_id', userData.user.id).maybeSingle();
  if (!caller?.is_owner) return NextResponse.json({ error: 'Only an Owner can invite users' }, { status: 403 });

  let body: { full_name?: string; email?: string; role?: string; department?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const fullName = String(body.full_name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const roleInput = String(body.role || '').trim().toLowerCase();
  const department = String(body.department || '').trim() || null;

  if (!fullName) return NextResponse.json({ error: 'Full name is required' }, { status: 400 });
  if (!email || !email.includes('@')) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  if (!ALLOWED_DOMAINS.includes(email.split('@')[1] || '')) return NextResponse.json({ error: 'Use an HDS email (@homedelivery.com.au or @hdsau.com)' }, { status: 400 });
  if (!ROLES.includes(roleInput)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 });

  // Owner is an admin + is_owner; admin/manager are plain.
  const dbRole = roleInput === 'owner' ? 'admin' : roleInput;
  const isOwner = roleInput === 'owner';

  // Create the user + invite link (does NOT send Supabase's email).
  let link = '';
  let newUserId = '';
  try {
    const { data: gen, error: genErr } = await admin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { redirectTo: `${SITE_URL}/set-password` },
    });
    if (genErr || !gen) {
      const msg = genErr?.message || 'Could not create the invite';
      const code = /registered|exists/i.test(msg) ? 409 : 500;
      return NextResponse.json({ error: code === 409 ? 'A user with that email already exists.' : ('Invite failed: ' + msg) }, { status: code });
    }
    link = gen.properties?.action_link || '';
    newUserId = gen.user?.id || '';
  } catch (err) {
    return NextResponse.json({ error: 'Invite failed: ' + (err as Error).message }, { status: 500 });
  }
  if (!link || !newUserId) return NextResponse.json({ error: 'Invite link could not be generated' }, { status: 500 });

  // Create their role row (Invited status is derived from auth until they accept).
  const { error: insErr } = await admin.from('user_roles').insert({ user_id: newUserId, role: dbRole, department, full_name: fullName, is_owner: isOwner });
  if (insErr) {
    // Roll back the auth user so a failed role insert doesn't strand an account.
    try { await admin.auth.admin.deleteUser(newUserId); } catch { /* best-effort */ }
    return NextResponse.json({ error: 'Could not create the role: ' + insErr.message }, { status: 500 });
  }

  // Branded invite email via SendGrid (not Supabase's default).
  let emailed = false;
  try {
    if (process.env.SENDGRID_API_KEY) {
      const sg = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email, name: fullName }] }],
          from: { email: EMAIL_FROM, name: 'HDS IT Helpdesk' },
          subject: 'You’ve been invited to the HDS IT Helpdesk',
          content: [
            { type: 'text/plain', value: inviteEmailText({ name: fullName, roleLabel: roleInput, link }) },
            { type: 'text/html', value: inviteEmailHtml({ name: fullName, roleLabel: roleInput, link }) },
          ],
        }),
      });
      emailed = sg.ok;
      if (!sg.ok) console.error('team/invite: SendGrid error', sg.status, (await sg.text().catch(() => '')).slice(0, 200));
    }
  } catch (err) {
    console.error('team/invite: email failed', (err as Error).message);
  }

  return NextResponse.json({ ok: true, userId: newUserId, emailed });
}
