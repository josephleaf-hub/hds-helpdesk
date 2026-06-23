/* AI copy-edit for an outbound reply: tidy grammar/spelling/clumsy phrasing
   while preserving meaning, tone, and all technical content. Admin/manager only
   (Bearer JWT + user_roles). SUGGESTS only — the client previews and the admin
   accepts/dismisses; this never sends. Any failure returns a clean error and the
   composer keeps the admin's text. */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-haiku-4-5';

const SYSTEM = `You are a careful copy-editor for an IT helpdesk reply to a requester. Return ONLY the corrected text — no preamble, no commentary, no quotation marks, no markdown.

Rules:
- Fix spelling, grammar, and punctuation. Tighten awkward or clumsy phrasing.
- Preserve the meaning exactly. Do not add, remove, or infer information.
- Preserve the tone and level of formality. Do not make it more formal or more casual; do not add greetings, sign-offs, or pleasantries that weren't there.
- Preserve all technical content verbatim: system and product names, file paths (e.g. \\\\server\\share or /var/log), URLs, email addresses, ticket references (HDS-NNNN), commands, and any code or identifiers. Do NOT "correct" these.
- Keep the original formatting and line breaks.
- NEVER use dashes. Remove any em dashes (—), en dashes (–), or hyphens used as a dash or separator, and rewrite with commas, full stops, or parentheses. This is a hard rule. Ordinary hyphenated words such as "sign-in" or "sub-type" stay as they are.
- If the text is already clean and dash-free, return it unchanged.
- Output the corrected text and nothing else.`;

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

  let body: { text?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const text = String(body.text || '');
  if (!text.trim()) return NextResponse.json({ error: 'Nothing to polish' }, { status: 400 });
  if (text.length > 10000) return NextResponse.json({ error: 'Text too long (max 10,000 chars)' }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('polish-reply: ANTHROPIC_API_KEY is not configured');
    return NextResponse.json({ error: 'Polish is not configured.' }, { status: 503 });
  }

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 500, system: SYSTEM, messages: [{ role: 'user', content: text }] }),
    });
    if (!aiRes.ok) {
      const detail = (await aiRes.text().catch(() => '')).slice(0, 300);
      console.error('polish-reply: Anthropic error', aiRes.status, detail);
      return NextResponse.json({ error: 'Polish failed — your text is unchanged.' }, { status: 502 });
    }
    const data = await aiRes.json();
    let out = (data?.content?.[0]?.text || '').trim();
    // Defensive: strip a single layer of wrapping quotes / code fences if present.
    out = out.replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```$/i, '').trim();
    if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'"))) out = out.slice(1, -1).trim();
    if (!out) return NextResponse.json({ polished: text });   // fall back to original
    return NextResponse.json({ polished: out });
  } catch (err) {
    console.error('polish-reply: unexpected error', (err as Error).message);
    return NextResponse.json({ error: 'Polish failed — your text is unchanged.' }, { status: 502 });
  }
}
