// "House knowledge" — HDS facts and conventions the AI reads so it uses real
// values and follows our conventions (migration-v1.7). Staff read, admin write.

import { sb } from '@/lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

export const KNOWLEDGE_SECTIONS: { key: string; label: string; hint: string; placeholder: string }[] = [
  { key: 'email', label: 'Email & domains', hint: 'Domains, address format, signatures.', placeholder: 'e.g. Domains: @hdsau.com (primary) and @homedelivery.com.au. Address format: first.last@hdsau.com.' },
  { key: 'naming', label: 'Naming conventions', hint: 'Usernames, devices, groups.', placeholder: 'e.g. Username = first.last. Laptops named HDS-<assettag>. Security groups prefixed SG-.' },
  { key: 'licences', label: 'Licences & software', hint: 'Default licences/SKUs and standard apps.', placeholder: 'e.g. Office staff: Microsoft 365 Business Standard. Warehouse/drivers: Microsoft 365 F3. Standard apps: Outlook, Teams, rostering.' },
  { key: 'accounts', label: 'Accounts & AD / OUs', hint: 'Where accounts live, groups, MFA.', placeholder: 'e.g. New starters go in OU HDS/Users/Staff. MFA required. Add to "All Staff" distribution list.' },
  { key: 'how', label: 'How we do things', hint: 'Anything else the team should align on.', placeholder: 'e.g. Send credentials to the hiring manager, never to the new starter directly. Confirm approvals before granting access.' },
];

export type KnowledgeMap = Record<string, string>;

export async function getKnowledge(): Promise<KnowledgeMap> {
  const { data, error } = await sb.from('org_knowledge').select('section, body');
  const map: KnowledgeMap = {};
  if (!error && data) for (const r of data) map[r.section as string] = (r.body as string) || '';
  return map;
}

export async function saveKnowledge(section: string, body: string, updatedBy: string): Promise<void> {
  const { error } = await sb.from('org_knowledge').upsert({ section, body: body.trim(), updated_by: updatedBy }, { onConflict: 'section' });
  if (error) throw error;
}

// Server-side: format the house knowledge as a context block for AI prompts,
// using the caller's (service-role) client. Best-effort — never throws.
export async function fetchKnowledgeBlock(client: SupabaseClient): Promise<string> {
  try {
    const { data } = await client.from('org_knowledge').select('section, body');
    if (!data?.length) return '';
    const lines = KNOWLEDGE_SECTIONS
      .map(s => {
        const row = data.find(d => d.section === s.key);
        const body = ((row?.body as string) || '').trim();
        return body ? `${s.label}:\n${body}` : '';
      })
      .filter(Boolean);
    if (!lines.length) return '';
    return `\n\nHDS house knowledge — these are real, current facts and conventions for HDS. Use them directly (domains, licence names, OUs, naming, process) instead of inventing values, leaving [bracket] placeholders, or asking about something already covered here:\n\n${lines.join('\n\n')}`;
  } catch {
    return '';
  }
}
