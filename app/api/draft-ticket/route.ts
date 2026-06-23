/* AI assist for the admin "New ticket" modal: read a pasted email thread and
   return SUGGESTED ticket fields. Admin/manager only (Bearer JWT + user_roles).
   This NEVER writes to the database — it only returns suggestions; the admin
   reviews/edits and creates the ticket via the existing create-ticket route.
   A failed draft must never block manual ticket creation, so all failures
   return a clean error and the UI falls back to a blank form. */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { CAT_LABEL, SUB_TYPES, PRI_LABEL, DEPARTMENTS } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-4-6';

// The exact allowed values, sourced from the app's own constants — Claude is
// constrained to these so it can't invent categories/sub-types/etc.
function buildSystemPrompt(): string {
  const cats = Object.entries(CAT_LABEL).map(([k, l]) => `"${k}" (${l})`).join(', ');
  const subs = Object.entries(SUB_TYPES).map(([cat, list]) => `  - ${cat}: ${list.map(s => `"${s}"`).join(', ')}`).join('\n');
  const pris = Object.keys(PRI_LABEL).map(p => `"${p}"`).join(', ');
  const depts = DEPARTMENTS.map(d => `"${d}"`).join(', ');
  return `You are an IT-helpdesk assistant. You read a pasted email thread and extract a structured IT support ticket.

Return ONLY a single JSON object — no prose, no explanation, no markdown code fences. The object must have exactly these keys:
  subject, requester_name, requester_email, department, affected_user, category, sub_type, priority, description

Rules:
- requester_name / requester_email: extract from the email headers. Identify who ORIGINATED the request (the first person to raise the issue), not necessarily the last sender in the thread.
- affected_user: only fill if the request is clearly on behalf of someone other than the requester; otherwise "".
- description: a clean, concise summary of the actual issue or request in plain prose — NOT the raw thread. Capture any stated urgency or deadline.
- subject: a short one-line summary.
- category: MUST be exactly one of these keys: ${cats}. Return the KEY only (e.g. "support").
- sub_type: MUST be one of the exact strings allowed for the chosen category:
${subs}
- priority: MUST be exactly one of: ${pris}.
- department: MUST be exactly one of: ${depts}.
- For category, sub_type, priority, department: if you are unsure, return an empty string "" for that field rather than guessing. Never invent a value outside the allowed lists.
- NEVER use dashes in any text you write (subject, description). No em dashes, no en dashes, and no hyphen used as a dash or separator. Use commas, full stops, or parentheses instead. Ordinary hyphenated words such as "sign-in" or "sub-type" are fine.
- Return valid JSON only.`;
}

type Draft = {
  subject: string; requester_name: string; requester_email: string; department: string;
  affected_user: string; category: string; sub_type: string; priority: string; description: string;
};

// Keep only allowed values; anything unrecognised becomes "" so the form leaves it unset.
function sanitize(raw: Record<string, unknown>): Draft {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const category = Object.keys(CAT_LABEL).includes(str(raw.category)) ? str(raw.category) : '';
  const subType = category && (SUB_TYPES[category] || []).includes(str(raw.sub_type)) ? str(raw.sub_type) : '';
  const priority = Object.keys(PRI_LABEL).includes(str(raw.priority)) ? str(raw.priority) : '';
  const department = DEPARTMENTS.includes(str(raw.department)) ? str(raw.department) : '';
  return {
    subject: str(raw.subject), requester_name: str(raw.requester_name),
    requester_email: str(raw.requester_email), department, affected_user: str(raw.affected_user),
    category, sub_type: subType, priority, description: str(raw.description),
  };
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return NextResponse.json({ error: 'Missing or malformed Authorization header' }, { status: 401 });
  const accessToken = authHeader.slice(7);

  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  const { data: roleRow, error: roleErr } = await admin.from('user_roles').select('role').eq('user_id', userData.user.id).maybeSingle();
  if (roleErr) return NextResponse.json({ error: 'Role lookup failed: ' + roleErr.message }, { status: 500 });
  if (!roleRow || !['admin', 'manager'].includes(roleRow.role)) return NextResponse.json({ error: 'Account does not have IT staff access' }, { status: 403 });

  let body: { thread?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const thread = String(body.thread || '').trim();
  if (!thread) return NextResponse.json({ error: 'An email thread is required' }, { status: 400 });
  if (thread.length > 30000) return NextResponse.json({ error: 'Thread too long (max 30,000 chars)' }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('draft-ticket: ANTHROPIC_API_KEY is not configured');
    return NextResponse.json({ error: 'AI drafting is not configured.' }, { status: 503 });
  }

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: `Email thread:\n\n${thread}` }],
      }),
    });

    if (!aiRes.ok) {
      const detail = (await aiRes.text().catch(() => '')).slice(0, 300);
      console.error('draft-ticket: Anthropic error', aiRes.status, detail);
      return NextResponse.json({ error: 'AI drafting failed — please fill the form manually.' }, { status: 502 });
    }

    const data = await aiRes.json();
    const text = (data?.content?.[0]?.text || '').trim();
    if (!text) return NextResponse.json({ error: 'AI returned no draft — please fill the form manually.' }, { status: 502 });

    // Strip ```json … ``` fences if the model added them, then parse defensively.
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(cleaned); }
    catch {
      console.error('draft-ticket: JSON parse failed for:', cleaned.slice(0, 300));
      return NextResponse.json({ error: 'Could not read the AI draft — please fill the form manually.' }, { status: 502 });
    }

    return NextResponse.json({ ok: true, draft: sanitize(parsed) });
  } catch (err) {
    console.error('draft-ticket: unexpected error', (err as Error).message);
    return NextResponse.json({ error: 'AI drafting failed — please fill the form manually.' }, { status: 502 });
  }
}
