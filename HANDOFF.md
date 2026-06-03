# Project Handoff — HDS IT Helpdesk

Hi Claude. You're picking up an existing project. Please read this carefully before doing anything — it gives you the full context so we don't waste cycles re-explaining decisions or duplicating work.

## What this is

An internal IT helpdesk ticketing system for **HDS (Home Delivery Solutions)**, an Australian cold-chain logistics company. Staff submit IT tickets via a public form. IT admins/managers log in to triage, reply, and resolve. Notifications go to a shared helpdesk inbox; admins can reply to requesters from within the dashboard.

Live in production at the user's `*.netlify.app` URL — being used by real staff. Care accordingly: don't break the build, prefer additive changes, ask before invasive refactors.

## Architecture

- **Frontend:** three static HTML files (`index.html`, `login.html`, `admin.html`) — no framework, vanilla JS. Each is self-contained with CSS inlined.
- **Backend:** three Netlify serverless functions in `netlify/functions/`:
  - `submit-ticket.js` — public, accepts new tickets, writes to Supabase, sends notification via SendGrid
  - `my-tickets.js` — public, looks up tickets by requester email
  - `send-message.js` — authenticated, lets admins reply to requesters; also handles logging inbound replies
- **Database:** Supabase (Postgres). Schema in `supabase-setup.sql`. Row-Level Security policies in place — admins see everything, managers scoped to their department, enforced server-side.
- **Auth:** Supabase Auth. IT staff users are created via Supabase dashboard, then granted `admin` or `manager` role via an INSERT into `public.user_roles`.
- **Email:** SendGrid, transactional. From address `helpdesk@homedelivery.com.au` (Single Sender verified, not Domain Auth yet).
- **Deploy:** Netlify CI from this GitHub repo. `netlify.toml` runs `node generate-config.js` at build time, which writes `config.js` from env vars so no secrets sit in the repo.

## Design system

This project uses the **`hds-dash` skill** for all styling. You should already have it available as an installed skill. Always consult it for any visual change. Key tokens (don't ad-lib):

- Navy `#060D18`, Brand Blue `#1C64F2`, Brand Orange `#FF6B43`
- Page background `#F4F6F8`, card background white, 20px radius
- Font: Inter, body 13px, page title 24px/600, section title 14px/600
- Transparent topbar (NOT dark) with HDS logo top-right at 32px
- KPI cards with 4px left accent bar; tabs in `#E5E7EB` pill container

Logo URL (light backgrounds): `https://cdn.prod.website-files.com/69d48f8e8f01871806e7f5c4/69dc2749d52c90cf97e32309_Secondary-positive.png`

All emoji have been replaced with inline SVG icons (Lucide-style). Do not reintroduce emoji.

## Key files inventory

| File | Purpose |
|---|---|
| `index.html` | Staff portal — submit ticket + lookup |
| `login.html` | IT staff login (Supabase Auth) |
| `admin.html` | Admin dashboard — tickets, KPIs, modal, replies |
| `config.js` | **Gitignored.** Local dev only. Real Supabase URL + anon key. Generated at build time in prod from env vars. |
| `config.example.js` | Template, in repo. Shows what config.js needs. |
| `generate-config.js` | Build script, writes config.js from env vars during Netlify deploy. |
| `netlify.toml` | Netlify config, redirects, headers, build command. |
| `netlify/functions/submit-ticket.js` | Public ticket submission endpoint. |
| `netlify/functions/my-tickets.js` | Public ticket lookup by email. |
| `netlify/functions/send-message.js` | **Authenticated.** Validates Supabase JWT, checks role + department scope, sends email + logs note. |
| `supabase-setup.sql` | Schema, RLS policies, helpers. Includes the hardened role-aware policies. |
| `harden-rls.sql` | Standalone RLS hardening migration (for upgrading earlier deployments). |
| `migration-v1.1-messaging.sql` | v1.1 migration — adds `note_type` to `ticket_notes`, adds `'waiting-on-requester'` status. |
| `SETUP.md` | Original setup walkthrough. May be slightly out of date post-migration. |

## Environment variables (set in Netlify)

| Key | Notes |
|---|---|
| `SUPABASE_URL` | Project URL (e.g. `https://abcde.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret.** Used by serverless functions to bypass RLS for admin operations. |
| `SUPABASE_ANON_KEY_PUBLIC` | Same value as the Supabase anon key. Used by `generate-config.js` to bake into `config.js` at build. Not secret. |
| `SENDGRID_API_KEY` | **Secret.** Restricted to Mail Send. |
| `EMAIL_FROM` | `helpdesk@homedelivery.com.au` |
| `IT_SUPPORT_EMAIL` | `helpdesk@homedelivery.com.au` (same inbox; was originally two for from/to flexibility). |

## What has been shipped (v1.0 + v1.1)

**v1.0 — Live and working:**
- Staff portal with multi-step ticket form (category, sub-type, department, location, description)
- Email notification to `helpdesk@homedelivery.com.au` on new ticket
- Staff lookup of their own tickets by email
- Admin login with Supabase Auth
- Admin dashboard: KPIs, filterable table, ticket modal with status/priority/assignee, internal notes
- Overview tab with breakdowns by department/category/priority/assignment
- Department-scoped access for managers, enforced via Postgres RLS

**v1.1 — Just shipped, may have rough edges:**
- New `send-message` function (authenticated by Supabase JWT bearer token, validated server-side via service_role)
- Admin modal now has a "Reply to [requester]" panel with status-change radios and two actions:
  - **Send Email Reply** — outbound, emails the requester from helpdesk@ with `Re: [HDS-NNNN] subject` for Outlook threading
  - **Log their email reply** — inbound, no email sent, just logs the pasted reply as a note
- `ticket_notes.note_type` column now distinguishes `internal` / `outbound` / `inbound`
- Notes render with distinct icon + colour per type (grey/blue/orange)
- New ticket status `'waiting-on-requester'` (orange badge), in filter dropdown + status dropdowns

## What we know is rough or incomplete

- **Email deliverability:** SendGrid is on Single Sender verification, not Domain Auth. Notifications land in Outlook's "Other" folder, not Focused. Domain Auth (3 CNAME records on homedelivery.com.au) would fix this — pending whoever manages the domain DNS.
- **Inbound replies are manual:** when a requester replies to a reply email, it lands in helpdesk@'s inbox, not back in the dashboard. Admins copy-paste into "Log their email reply" to record it. Auto-threading via SendGrid Inbound Parse is the v2 upgrade — would need an MX record change and a new function.
- **There's currently a reported issue:** the user said "email comms don't seem to be working right" but didn't specify the symptom. **Confirm with them before investigating** — could be the reply not arriving, going to spam, threading wrong, or the function erroring.
- **No password reset UI:** if an IT staff member forgets their password, only the user can reset it via Supabase dashboard. Worth building a "Forgot password?" flow eventually.
- **No attachments yet:** Supabase Storage isn't wired up. Listed as v1.2 candidate.
- **Static success-screen text:** the post-submit message reads generically ("The IT team has been notified and will respond shortly") — was previously a hardcoded wrong email address, fixed before handoff.

## Conventions established in this codebase

- **No emoji** — all icons are inline SVG (Lucide-style, stroke-based, `currentColor` so they inherit text colour).
- **CSS is fully inlined per HTML file** — historical decision because of single-file preview environments. When refactoring, you can extract to a shared `styles.css` again now that we have proper builds, but don't do it without discussing.
- **Status values are hyphenated:** `open`, `in-progress`, `waiting-on-requester`, `on-hold`, `resolved`, `closed`. Match this style for any new statuses.
- **Note types are lowercase singular:** `internal`, `outbound`, `inbound`.
- **Auth pattern for new authenticated functions:** read `Authorization: Bearer <token>` header, validate with admin client's `auth.getUser(token)`, then look up the user's role/department in `user_roles` to authorise. `send-message.js` is the reference implementation.
- **The Supabase JS client global is `window.supabase` (CDN-loaded). Our local client must be named `sb`, not `supabase`,** to avoid a SyntaxError from redeclaration. This bit us once already.
- **Manager scope is enforced both client-side (filter) and server-side (RLS + function checks).** Both layers exist on purpose — don't remove either.

## Suggested next actions

1. **Resolve the reported email issue first** — ask the user for the specific symptom, then investigate.
2. Look at Netlify function logs for `send-message` to see what's happening on recent invocations: `netlify functions:log send-message` or via the Netlify UI under Logs → Functions.
3. Consider whether the issue justifies finally setting up SendGrid Domain Auth (improves deliverability dramatically and is one-time DNS work).

## Working agreement

- This is production. Prefer small, additive, reviewable changes over rewrites.
- For any visual change: read the `hds-dash` skill first. Don't ad-lib styles.
- When changing schema, write a separate migration file (don't edit `supabase-setup.sql` in place) so live deployments can upgrade cleanly.
- When in doubt about user intent — ask. The user is a designer working across design, comms, and operations, not a full-time engineer. Surface trade-offs clearly.

## Useful commands

```bash
netlify dev                          # local server with functions, env vars, hot reload
netlify functions:log send-message   # tail the function logs from production
netlify env:list                     # confirm env vars are set
git status                           # what's changed
git push                             # deploys to production via Netlify CI
```

Ready when you are. The first thing I'd suggest: ask the user what specifically is wrong with the email, then we triage from there.