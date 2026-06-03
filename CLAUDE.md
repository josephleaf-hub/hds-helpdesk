# HDS IT Helpdesk — Project Conventions

This document is the source of truth for *how this codebase is built*. It complements `HANDOFF.md` (which covers *what's been built*) and `MIGRATION-RUNBOOK.md` (the one-time setup).

Anyone working on this project — Joseph, Claude Code, a future contractor, future-you in six months — should read this before making changes. Following these conventions is what keeps the codebase coherent and the system on-brand.

---

## 1. Design system — `hds-dash` is the source of truth

All visual decisions defer to the **`hds-dash` skill**. It's installed in the Claude account and travels with Claude across environments (this chat, Claude Code, Claude in Chrome, etc.).

### The non-negotiable rules

When making any visual change, follow `hds-dash` exactly. Specifically:

| Element | Spec |
|---|---|
| Page background | `#F4F6F8` |
| Card background | `#FFFFFF` |
| Card radius | `20px` |
| Card padding | `15px` (forms can use `20px` for breathing room) |
| Card shadow | `0 1px 2px -1px rgba(0,0,0,0.10), 0 1px 3px 0 rgba(0,0,0,0.10)` |
| Brand navy | `#060D18` |
| Brand blue | `#1C64F2` |
| Brand orange | `#FF6B43` |
| Body text | `#0F1C2E` |
| Muted text | `#6B7280` |
| Border | `#C8D4DF` |
| Font | Inter, fallback to `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` |
| Body font-size | `13px` |
| Page title (h1) | `24px / 600` |
| Section title | `14px / 600` |
| Max width | `1800px` |

### What the topbar must look like

- Transparent (NOT a dark navy bar)
- Sits directly on the page background
- HDS logo top-right at `32px` height
- Page title + subtitle on the left
- Action buttons + user pill between title and logo, separated by `1px × 24px` divider lines (`.logo-divider-line`)

The dark navy header we had at the start was wrong — `hds-dash` is explicit: no dark headers, no gradient bands, no cyan strips. Don't reintroduce them.

### HDS logo (always use the canonical CDN URL)

- Light backgrounds (default): `https://cdn.prod.website-files.com/69d48f8e8f01871806e7f5c4/69dc2749d52c90cf97e32309_Secondary-positive.png`
- Dark backgrounds: `https://i.ibb.co/PGv312fb/Teritary-reversed.png` (rarely needed here)
- HDS + Arctech combined (dark bg): `https://i.ibb.co/JFqC4jXj/hds-arctech-white-4x.png`

**Never use random image-host URLs (ibb.co, imgur, etc.) for logos.** They can vanish without warning.

### When in doubt — read the skill

If you're about to invent a colour, size, radius, or spacing value, stop. Read `hds-dash` first. If the answer's not there, ask Joseph rather than guessing — that's how brand drift happens.

---

## 2. CSS conventions

### Where styles live

Each HTML file currently has its full stylesheet **inlined in a `<style>` block in the `<head>`**. This is a deliberate historical choice — it made single-file previews work in environments that couldn't load sibling stylesheets.

**You may now refactor to a shared `styles.css`** if it genuinely simplifies the codebase, since the proper build pipeline supports it. But:

- Don't do it casually as a "cleanup" — discuss with Joseph first
- If you do extract, make sure `index.html`, `login.html`, and `admin.html` all reference it identically
- Keep the design-token block at the very top of `styles.css`, as both a CSS variable declaration AND a comment listing every token:

```css
/* HDS Design System — see hds-dash skill for full spec
   Navy   #060D18    Blue        #1C64F2    Orange   #FF6B43
   BG     #F4F6F8    Border      #C8D4DF    Text-1   #0F1C2E
   Text-2 #6B7280    Text-3      #8A97A8    Text-link #1C64F2
   Font   Inter      Card radius 20px       Body     13px
*/
:root {
  --navy:         #060D18;
  --blue:         #1C64F2;
  /* etc */
}
```

### Naming

- Component classes use kebab-case: `.kpi-card`, `.tab-bar`, `.note-meta`
- State modifiers use `.is-` or `.active`: `.tab-btn.active`, `.is-loading`
- Semantic badge classes use the `b-` prefix: `.b-open`, `.b-resolved`, `.b-waiting`
- Don't introduce utility frameworks (no Tailwind, no Bootstrap). The project is consciously framework-free for simplicity and performance.

### Inline styles

Inline `style="…"` is fine for one-off layout adjustments (margins, widths in a specific context). Avoid inline styles for anything that's part of the design system — that goes in CSS classes so changes propagate.

### Responsive

Mobile breakpoint is `@media (max-width: 768px)`. Tablet and below collapse multi-column grids to single column. Don't introduce new breakpoints without good reason.

### What NOT to do

- No CSS preprocessors (no Sass, no Less) — kept as plain CSS so anyone can edit
- No CSS-in-JS — the project is vanilla JS, not React
- No animation libraries — use plain CSS transitions where needed
- No "creative" colour palettes — stick to the brand tokens

---

## 3. Icons — inline SVG only

**No emoji. Anywhere. Ever.** This is a hard rule.

All icons are inline SVG, Lucide-style. They follow this exact pattern:

```html
<svg width="17" height="17" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
     style="vertical-align:-3px;flex-shrink:0;">
  <!-- paths from lucide.dev -->
</svg>
```

### Sizing conventions

| Context | Size |
|---|---|
| Tab buttons, leading-text icons | `16-17px` |
| Modal close button | `16px` |
| Refresh / inline action icons | `14px` |
| Category cards (hero icons) | `28px` |
| Success / error large states | `34-44px` |
| Note meta indicators | `14px` |

### Colour

Use `stroke="currentColor"` so icons inherit text colour. For accent colours (category icons in brand blue, error states in red), use inline `style="color:#1C64F2"`.

### Where to find new icons

https://lucide.dev — search by name, copy the SVG path data. The pattern above wraps any path content.

### What NOT to do

- No emoji as icons (🎫📋✅⚠️ etc.) — they render inconsistently across OS and look unprofessional
- No icon fonts (Font Awesome, Material Icons) — external dependency, accessibility issues
- No PNG/JPG icons — they don't scale or recolour cleanly

The plain arrows `→` and `←` in buttons are NOT emoji and may stay. They're standard typographic characters that render universally.

---

## 4. JavaScript conventions

### Style

- Vanilla ES6+, no framework
- Use `const` by default, `let` only when reassignment is needed
- Async/await over `.then()` chains
- Template literals for HTML construction (mind escaping — use `esc()` for user-provided strings)
- One file per page (no module bundling) — the HTML files load their own `<script>` block

### Critical naming rule

**The Supabase JS client global from the CDN is `window.supabase`.** Our local instance must therefore be called `sb`, not `supabase`. Redeclaring `const supabase` triggers a SyntaxError that breaks the entire script. Don't repeat this mistake.

```javascript
// ✅ Correct
const sb = window.supabase.createClient(...);
await sb.auth.getSession();

// ❌ Wrong — silently breaks all JS on the page
const supabase = window.supabase.createClient(...);
```

### Always escape user-provided content

```javascript
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
// Use it whenever interpolating into HTML
element.innerHTML = `<div>${esc(userName)}</div>`;
```

Already used everywhere in `admin.html` — match the pattern.

### Status / priority / category values

Use the canonical values, hyphenated, lowercase:

- Statuses: `open`, `in-progress`, `waiting-on-requester`, `on-hold`, `resolved`, `closed`
- Priorities: `low`, `medium`, `high`, `urgent`
- Note types: `internal`, `outbound`, `inbound`
- Categories: see `CAT_LABEL` map in `index.html`

When adding a new value to any of these, update **every** place it's referenced: the `_LABEL` map, the `_ORDER` map (if it's sortable), the badge class map, the filter dropdowns, the SQL CHECK constraint.

---

## 5. Database conventions

### Schema changes are migrations, not edits

**Never edit `supabase-setup.sql` in place.** That file represents the original schema. Schema changes go in a numbered migration file:

```
migration-v1.1-messaging.sql
migration-v1.2-attachments.sql
migration-v1.3-something.sql
```

Each migration:

- Uses `IF NOT EXISTS` / `IF EXISTS` where possible so it's idempotent (safe to re-run)
- Has a header comment explaining what it does and that it's safe to run on production
- Lives in the project root, gets committed to git
- Gets run manually in the Supabase SQL Editor by Joseph (no auto-migration tooling yet)

When updating a CHECK constraint, drop and recreate (Postgres doesn't have ALTER CONSTRAINT for CHECK):

```sql
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('open', 'in-progress', 'waiting-on-requester', 'on-hold', 'resolved', 'closed'));
```

### Row-Level Security is non-negotiable

The RLS policies (admins see all, managers scoped to their department, no one else sees anything) are enforced at the database layer. **Never disable RLS** on `tickets`, `ticket_notes`, or `user_roles`. If a new policy is needed, add it alongside the existing ones — don't disable to "make things work."

If your code needs to bypass RLS for admin operations (like the serverless functions do), use the `service_role` key on a server-side client. Never put `service_role` in the browser.

### Manager scope must be enforced server-side

Client-side filters are convenience; server-side RLS and function-level checks are the actual security. Both layers exist on purpose. Don't remove server-side checks even if the UI already filters.

---

## 6. Serverless function conventions

All Netlify functions follow this skeleton:

```javascript
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// ... other env vars

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function res(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...CORS },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return res(405, { error: 'Method not allowed' });

  // 1. Auth (if applicable)
  // 2. Parse + validate input
  // 3. Business logic
  // 4. Return res(200, { ok: true, ... })
};
```

### Authenticated functions

If the function needs to verify the caller is a logged-in IT staff member, follow the pattern in `send-message.js`:

1. Read `Authorization: Bearer <token>` header
2. Validate with `admin.auth.getUser(token)` (admin client uses service_role)
3. Look up the user's role in `public.user_roles`
4. Authorize (admin: all; manager: must match ticket department)
5. Proceed

Public endpoints (like `submit-ticket`) don't need auth but should still validate input strictly.

### Logging

Use `console.log` / `console.error` — Netlify captures and surfaces them in the Functions logs UI. Don't log sensitive data (no tokens, no full email bodies, no PII beyond what's strictly needed for debugging).

### Error responses

Return structured JSON with an `error` field. Use appropriate status codes (400 bad input, 401 not authed, 403 not authorised, 404 not found, 500 server error, 502 upstream failure).

---

## 7. Email conventions

All transactional email goes through SendGrid via the serverless functions. Never call SendGrid from the browser (would expose the API key).

### Templates

Email HTML follows a consistent structure (see `submit-ticket.js` and `send-message.js`):

- Outer wrapper at `#F4F6F8` background, centered
- Inner card at white, 12px radius, max-width 600px
- Inter font with sensible system fallbacks (email clients don't always load web fonts)
- Inline CSS only — no `<style>` blocks, no external stylesheets (most email clients strip them)
- Both `text/plain` AND `text/html` content blocks — accessibility, deliverability

### Threading

For replies to an existing ticket, the subject line MUST be `Re: [HDS-NNNN] {original subject}`. The `[HDS-NNNN]` token is what Outlook uses to thread replies. Don't change this format.

### Sender address

`EMAIL_FROM` env var → currently `helpdesk@homedelivery.com.au`. The address must be verified in SendGrid (Single Sender today, Domain Auth eventually).

---

## 8. Repository hygiene

### What's in git

Everything in the project folder EXCEPT what's listed in `.gitignore`. That means: source code, schema files, migrations, config templates, documentation.

### What's NOT in git

- `node_modules/` — npm install regenerates this
- `.env`, `.env.local` — never commit secrets
- `.netlify/` — local CLI state
- `config.js` — contains real keys, regenerated at build time from env vars
- `.DS_Store`, `.vscode/`, OS/editor garbage

### Commit messages

Short, present-tense, imperative. Mention scope if obvious.

```
✅ "add waiting-on-requester status"
✅ "fix supabase const redeclaration in login"
✅ "send-message: validate jwt before any DB calls"

❌ "stuff"
❌ "WIP"
❌ "fixing things that were broken"
```

### Branching

For low-risk changes, commit to `main` directly. For risky / experimental changes, branch:

```bash
git checkout -b feat/attachments
# work, commit, push
# Netlify gives you a preview URL for the branch automatically
# when merged to main → production deploy
```

---

## 9. Working with Claude / Claude Code

### Before any visual change

Claude reads `hds-dash` first — every time, no exceptions. If a response includes a colour, radius, font size, or spacing value that wasn't pulled from the skill or the existing CSS, push back.

### Before any feature change

Claude reads this file and `HANDOFF.md` to understand context. If working in Claude Code, those files are in the repo and read automatically.

### Code change protocol

For non-trivial changes, Claude should:

1. State what's about to change and why (one or two sentences)
2. Show the diff before applying
3. Run any available checks (`node --check`, validate HTML, etc.)
4. Confirm what's been changed

Avoid: massive sweeping refactors without checkpoints, undocumented assumptions, "while I'm here let me also…" scope creep.

### When in doubt

Ask. Joseph is a designer working across many areas, not a full-time engineer. Surface trade-offs in plain language. Don't quietly choose an approach that has implications he should weigh in on.

---

## 10. Things explicitly NOT in scope (yet)

These are off the table without a deliberate decision to add them:

- Frontend frameworks (React, Vue, Svelte, etc.)
- CSS preprocessors or utility frameworks
- TypeScript
- Backend frameworks (Express, Fastify, etc.) — serverless functions stay simple
- ORMs — Supabase JS client is the only DB access pattern
- Test frameworks — manual smoke testing for now, formal tests come if/when the codebase justifies them
- Internationalisation — English only, AU conventions
- Multi-tenancy — single HDS tenant, hardcoded

If any of these become genuinely needed, that's a deliberate v2 architectural conversation, not a quiet addition during a feature build.

---

## Quick reference card

When in doubt:

| Question | Answer |
|---|---|
| What colour should I use? | See `hds-dash` |
| What font size for this? | See `hds-dash` type scale (13/14/24px etc.) |
| Should I add an icon for this? | Yes — inline SVG, Lucide-style, never emoji |
| Should I edit `supabase-setup.sql`? | No — write a migration file |
| Can I disable RLS just for this? | No |
| Should I name my Supabase client `supabase`? | No — name it `sb` |
| Should I extract this to a shared CSS file? | Maybe — discuss first |
| Should I add this framework / library? | Probably no — discuss first |
| Should I rewrite this module? | Probably no — make additive changes |
| Should I ask before doing X? | If you're asking the question, yes |