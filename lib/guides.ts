// Help-guide data layer — the editable knowledge bank (migration-v1.6).
// All access is RLS-scoped via the browser `sb` client: staff read, admins write.

import { sb } from '@/lib/supabase';

export interface HelpGuide {
  id: string;
  category: string;
  sub_type: string | null;
  title: string;
  questions: string[];
  steps: string[];
  usage_count: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

// Raw row → normalised guide (jsonb arrays may come back as unknown).
function normalise(row: Record<string, unknown>): HelpGuide {
  const arr = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return {
    id: String(row.id),
    category: String(row.category),
    sub_type: (row.sub_type as string | null) ?? null,
    title: String(row.title || ''),
    questions: arr(row.questions),
    steps: arr(row.steps),
    usage_count: Number(row.usage_count || 0),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
    updated_by: (row.updated_by as string | null) ?? null,
  };
}

// Find the best guide for a ticket: exact category+sub_type wins, else fall back
// to a category-wide guide (sub_type IS NULL). Most recently updated within a tier.
export async function matchGuide(category: string, subType: string | null): Promise<HelpGuide | null> {
  const { data, error } = await sb
    .from('help_guides')
    .select('*')
    .eq('category', category)
    .order('updated_at', { ascending: false });
  if (error || !data?.length) return null;
  const rows = data.map(normalise);
  // 1. Exact sub-type match wins.
  if (subType) {
    const exact = rows.find(g => g.sub_type === subType);
    if (exact) return exact;
  }
  // 2. A category-wide guide (no sub-type set).
  const categoryWide = rows.find(g => g.sub_type == null);
  if (categoryWide) return categoryWide;
  // 3. Ticket has no sub-type → surface the category's guide anyway (most recent).
  //    If it has a specific sub-type with no matching guide, don't show an
  //    unrelated sub-type's guide (could mislead).
  if (!subType) return rows[0] || null;
  return null;
}

// Count a surfacing. Best-effort: a failure here must never block the rail.
export async function incrementUsage(guideId: string): Promise<void> {
  try { await sb.rpc('increment_guide_usage', { gid: guideId }); } catch { /* non-critical */ }
}

export async function listGuides(): Promise<HelpGuide[]> {
  const { data, error } = await sb.from('help_guides').select('*').order('category').order('sub_type', { nullsFirst: true });
  if (error || !data) return [];
  return data.map(normalise);
}

export async function getGuide(id: string): Promise<HelpGuide | null> {
  const { data, error } = await sb.from('help_guides').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return normalise(data);
}

export interface GuideInput {
  category: string;
  sub_type: string | null;
  title: string;
  questions: string[];
  steps: string[];
  updated_by: string;
}

// Create (id omitted) or update (id present). Returns the saved guide's id.
export async function saveGuide(input: GuideInput, id?: string): Promise<string> {
  const payload = {
    category: input.category,
    sub_type: input.sub_type || null,
    title: input.title.trim(),
    questions: input.questions.map(q => q.trim()).filter(Boolean),
    steps: input.steps.map(s => s.trim()).filter(Boolean),
    updated_by: input.updated_by,
  };
  if (id) {
    const { error } = await sb.from('help_guides').update(payload).eq('id', id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await sb.from('help_guides').insert(payload).select('id').single();
  if (error) throw error;
  return String(data.id);
}

export async function deleteGuide(id: string): Promise<void> {
  const { error } = await sb.from('help_guides').delete().eq('id', id);
  if (error) throw error;
}
