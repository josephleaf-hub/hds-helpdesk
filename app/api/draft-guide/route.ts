/* AI assist for the guide editor: from an admin's description of a task, draft a
   guide (title, clarifying questions, ordered resolution steps) + a suggested
   category/sub-type. Admin/manager only (Bearer JWT + user_roles). SUGGESTS only
   — fills the editor form; nothing saves until the admin clicks Create/Save.
   Honest about gaps: HDS-specific unknowns are written as [bracketed] placeholders
   rather than invented. Any failure returns a clean error; manual writing still
   works. */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { CAT_LABEL, SUB_TYPES } from '@/lib/constants';
import { fetchKnowledgeBlock } from '@/lib/orgKnowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-4-6';

function buildSystemPrompt(passedCategory: string): string {
  const cats = Object.entries(CAT_LABEL).map(([k, l]) => `"${k}" (${l})`).join(', ');
  const subs = Object.entries(SUB_TYPES).map(([cat, list]) => `  - ${cat}: ${list.map(s => `"${s}"`).join(', ')}`).join('\n');
  return `You are an IT-helpdesk knowledge author for HDS (Home Delivery Solutions). From a short description of a recurring IT task, you draft a reusable resolution guide.

Return ONLY a single JSON object — no prose, no markdown fences. Exactly these keys:
  title, suggested_category, suggested_sub_type, questions, steps, mismatch, mismatch_category

Rules:
- title: a short, clear name for the guide (e.g. "New Starter Setup").
- questions: array of clarifying questions the agent should ask the requester before starting. Concrete and useful; usually 2-5.
- steps: array of ordered resolution steps in plain imperative sentences. Keep it concise: AT MOST 8 steps. Write for an experienced IT support person who already knows the basics, so do NOT spell out obvious actions (logging in, basic menu navigation, clicking standard buttons). Combine trivial sub-steps and focus on the decisions, the HDS-specific details, and the steps that actually matter.
- HONEST GAPS: where a step depends on HDS-specific detail you cannot know (tenant, AD OUs, licence/SKU names, internal tool or system names, server paths), write the step with a placeholder in SQUARE BRACKETS, e.g. "Assign the licence ([confirm which licence HDS uses])". Never invent specifics — an honest gap is better than confident fiction.
- suggested_category: MUST be one of these KEYS or "": ${cats}.
- suggested_sub_type: MUST be one of the exact strings allowed for the chosen category, or "":
${subs}
- If unsure of category/sub_type, return "".
- NEVER use dashes in any text you write (title, questions, steps). No em dashes, no en dashes, and no hyphen used as a dash or separator. Use commas, full stops, or parentheses instead. This is a hard rule. Ordinary hyphenated words such as "sign-in" or "sub-type" are fine, and square-bracket placeholders are required as described above.
${passedCategory ? `- The author tentatively filed this under category "${passedCategory}". If the described task clearly belongs to a DIFFERENT category, set mismatch=true and mismatch_category to the KEY it actually belongs to. Do NOT contort the guide to fit "${passedCategory}". If it fits, mismatch=false and mismatch_category "".` : `- No category was provided. Set mismatch=false and mismatch_category "".`}
- Return valid JSON only.`;
}

type DraftGuide = {
  title: string; suggestedCategory: string; suggestedSubType: string;
  questions: string[]; steps: string[]; mismatch: boolean; mismatchCategory: string;
};

function sanitize(raw: Record<string, unknown>, passedCategory: string): DraftGuide {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const arr = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(s => s.trim()).filter(Boolean) : [];
  const cat = Object.keys(CAT_LABEL).includes(str(raw.suggested_category)) ? str(raw.suggested_category) : '';
  const sub = cat && (SUB_TYPES[cat] || []).includes(str(raw.suggested_sub_type)) ? str(raw.suggested_sub_type) : '';
  const mmCat = Object.keys(CAT_LABEL).includes(str(raw.mismatch_category)) ? str(raw.mismatch_category) : '';
  // Mismatch only counts when a category was passed, the model flagged it, and the
  // suggested category is a real, different one.
  const mismatch = !!passedCategory && raw.mismatch === true && !!mmCat && mmCat !== passedCategory;
  return {
    title: str(raw.title), suggestedCategory: cat, suggestedSubType: sub,
    questions: arr(raw.questions), steps: arr(raw.steps),
    mismatch, mismatchCategory: mismatch ? mmCat : '',
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

  let body: { prompt?: string; category?: string; subType?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const prompt = String(body.prompt || '').trim();
  const passedCategory = Object.keys(CAT_LABEL).includes(String(body.category || '')) ? String(body.category) : '';
  const passedSub = String(body.subType || '').trim();
  if (!prompt) return NextResponse.json({ error: 'Describe the task to draft a guide.' }, { status: 400 });
  if (prompt.length > 8000) return NextResponse.json({ error: 'Description too long (max 8,000 chars)' }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('draft-guide: ANTHROPIC_API_KEY is not configured');
    return NextResponse.json({ error: 'AI drafting is not configured.' }, { status: 503 });
  }

  const userContent = `Task to write a guide for:\n${prompt}${passedCategory ? `\n\n(Author tentatively filed under category "${passedCategory}"${passedSub ? `, sub-type "${passedSub}"` : ''}.)` : ''}`;
  const knowledge = await fetchKnowledgeBlock(admin);

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        system: buildSystemPrompt(passedCategory) + knowledge,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    if (!aiRes.ok) {
      const detail = (await aiRes.text().catch(() => '')).slice(0, 300);
      console.error('draft-guide: Anthropic error', aiRes.status, detail);
      return NextResponse.json({ error: 'AI drafting failed — write the guide manually.' }, { status: 502 });
    }
    const data = await aiRes.json();
    const text = (data?.content?.[0]?.text || '').trim();
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(cleaned); }
    catch {
      console.error('draft-guide: JSON parse failed for:', cleaned.slice(0, 300));
      return NextResponse.json({ error: 'Could not read the AI draft — write the guide manually.' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, draft: sanitize(parsed, passedCategory) });
  } catch (err) {
    console.error('draft-guide: unexpected error', (err as Error).message);
    return NextResponse.json({ error: 'AI drafting failed — write the guide manually.' }, { status: 502 });
  }
}
