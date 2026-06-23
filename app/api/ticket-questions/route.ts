/* AI assist for the help-guide rail's "For this ticket" section. Reads a ticket
   + its full conversation and returns up to 3-4 clarifying questions the resolver
   should still ask, plus a category-match assessment. Admin/manager only (Bearer
   JWT + user_roles; managers scoped to their department). SUGGESTS only — never
   writes, never re-categorises. Any failure returns a clean error; the rail
   degrades to the static guide + manual question-asking. */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { CAT_LABEL } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-4-6';

function buildSystemPrompt(): string {
  const cats = Object.entries(CAT_LABEL).map(([k, l]) => `"${k}" (${l})`).join(', ');
  return `You are an IT-helpdesk assistant helping a support agent resolve a ticket faster.

You are given a ticket (subject, description, its assigned category) and the full conversation so far between the IT team and the requester.

Return ONLY a single JSON object, no prose, no markdown fences. Exactly these keys:
  questions  (array of strings),
  complete   (boolean),
  category_fit (string: "good", "weak", or "mismatch"),
  suggested_category (string)

Rules for "questions":
- List up to 4 SPECIFIC clarifying questions the agent should still ask THIS requester to resolve the ticket faster.
- Only surface genuinely missing or ambiguous information. Be concrete to this ticket, not generic.
- Account for what has ALREADY been answered or corrected in the conversation. Never re-ask something the thread already covers.
- Each question is a single, directly-askable sentence.
- If the ticket already contains everything needed to proceed, return an empty array and set "complete" to true.

Rules for "complete":
- true only when there is nothing useful left to ask; otherwise false.

Rules for category fit (assess how well the ticket CONTENT matches its assigned category):
- "good": the content clearly fits the assigned category. Set suggested_category to "".
- "weak": the assigned category is plausible but the content points more towards another category, OR the ticket looks like it was categorised by a quick guess or a default rather than deliberately. Set suggested_category to the KEY it more likely belongs to.
- "mismatch": the content plainly contradicts the assigned category. Set suggested_category to the KEY it clearly belongs to.
- Most tickets are categorised by the requester at submission, often by a rough guess, so when the fit is not clearly good lean towards "weak" and offer a suggestion rather than staying silent.
- suggested_category MUST be one of these KEYS or "": ${cats}. It must differ from the assigned category.

Other rules:
- NEVER use dashes in any question you write. No em dashes, no en dashes, and no hyphen used as a dash or separator. Use commas, full stops, or parentheses instead. This is a hard rule. Ordinary hyphenated words such as "sign-in" or "sub-type" are fine.
- Return valid JSON only.`;
}

type Note = { note_text: string | null; note_type: string; created_at: string };

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return NextResponse.json({ error: 'Missing or malformed Authorization header' }, { status: 401 });
  const accessToken = authHeader.slice(7);

  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  const { data: roleRow, error: roleErr } = await admin.from('user_roles').select('role, department').eq('user_id', userData.user.id).maybeSingle();
  if (roleErr) return NextResponse.json({ error: 'Role lookup failed: ' + roleErr.message }, { status: 500 });
  if (!roleRow || !['admin', 'manager'].includes(roleRow.role)) return NextResponse.json({ error: 'Account does not have IT staff access' }, { status: 403 });

  let body: { ticketId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const ticketId = String(body.ticketId || '').trim();
  if (!ticketId) return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });

  const { data: ticket, error: tErr } = await admin
    .from('tickets').select('id, subject, description, category, sub_type, department').eq('id', ticketId).maybeSingle();
  if (tErr) return NextResponse.json({ error: 'Ticket lookup failed: ' + tErr.message }, { status: 500 });
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  if (roleRow.role === 'manager' && ticket.department !== roleRow.department) return NextResponse.json({ error: 'Manager scope does not include this ticket' }, { status: 403 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ticket-questions: ANTHROPIC_API_KEY is not configured');
    return NextResponse.json({ error: 'AI suggestions are not configured.' }, { status: 503 });
  }

  const { data: noteRows } = await admin
    .from('ticket_notes').select('note_text, note_type, created_at').eq('ticket_id', ticketId).order('created_at', { ascending: true });
  const convo = (noteRows as Note[] | null || [])
    .map(n => {
      const who = n.note_type === 'inbound' ? 'Requester' : n.note_type === 'internal' ? 'Internal note (IT)' : 'IT';
      return `${who}: ${(n.note_text || '').trim()}`;
    })
    .filter(l => l.length > 12)
    .join('\n');

  const userContent = `Assigned category: "${ticket.category}" (${CAT_LABEL[ticket.category] || ticket.category})${ticket.sub_type ? ` / sub-type: "${ticket.sub_type}"` : ''}
Subject: ${ticket.subject}
Description: ${ticket.description || '(none)'}

Conversation so far:
${convo || '(no messages yet)'}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    if (!aiRes.ok) {
      const detail = (await aiRes.text().catch(() => '')).slice(0, 300);
      console.error('ticket-questions: Anthropic error', aiRes.status, detail);
      return NextResponse.json({ error: 'AI suggestions failed — ask manually.' }, { status: 502 });
    }
    const data = await aiRes.json();
    const text = (data?.content?.[0]?.text || '').trim();
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(cleaned); }
    catch {
      console.error('ticket-questions: JSON parse failed for:', cleaned.slice(0, 300));
      return NextResponse.json({ error: 'Could not read the AI suggestions — ask manually.' }, { status: 502 });
    }

    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.filter((q): q is string => typeof q === 'string').map(q => q.trim()).filter(Boolean).slice(0, 4)
      : [];
    const complete = parsed.complete === true || questions.length === 0;

    // Category fit: 'weak' (quiet suggestion) or 'mismatch' (firmer flag) surface
    // a one-tap suggestion; 'good' shows nothing. Never act on it, just surface.
    const fit = ['good', 'weak', 'mismatch'].includes(parsed.category_fit as string) ? parsed.category_fit as string : 'good';
    const suggested = typeof parsed.suggested_category === 'string' ? parsed.suggested_category.trim() : '';
    const validSuggestion = Object.keys(CAT_LABEL).includes(suggested) && suggested !== ticket.category;
    const mismatch = fit !== 'good' && validSuggestion
      ? { suggested, level: fit === 'mismatch' ? 'mismatch' : 'weak' }
      : null;

    return NextResponse.json({ ok: true, questions, complete, mismatch });
  } catch (err) {
    console.error('ticket-questions: unexpected error', (err as Error).message);
    return NextResponse.json({ error: 'AI suggestions failed — ask manually.' }, { status: 502 });
  }
}
