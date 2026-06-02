# HDS IT Helpdesk — Setup Guide

Complete setup takes approximately 30–45 minutes.

---

## What You're Deploying

Three pages hosted on Netlify:

| URL | Who Uses It | Login? |
|---|---|---|
| `yoursite.netlify.app/` | All HDS staff — submit tickets, view their own | No |
| `yoursite.netlify.app/login` | IT team & managers | Yes |
| `yoursite.netlify.app/admin` | IT team & managers — full ticket dashboard | Yes (auto-redirect) |

When a ticket is submitted, an email goes to `itsupporttickets@hdsau.com.au` automatically.

---

## Step 1 — Set Up Supabase (the database)

Supabase is the free database that stores all tickets and handles IT staff logins.

1. Go to [supabase.com](https://supabase.com) and sign up for a free account
2. Click **New Project** — name it `hds-helpdesk`, choose a strong database password, pick **Sydney** as the region
3. Wait ~2 minutes for it to provision
4. In the left sidebar go to **SQL Editor**
5. Click **New Query**, paste the entire contents of `supabase-setup.sql`, and click **Run**
6. You should see "Success. No rows returned."

**Grab your credentials** (you'll need these later):
- Go to **Project Settings → API**
- Copy **Project URL** → looks like `https://abcdefgh.supabase.co`
- Copy **anon / public** key → long string starting with `eyJ...`
- Copy **service_role** key → another long string (keep this secret)

---

## Step 2 — Add IT Staff Accounts

For each person who needs admin/manager access:

1. In Supabase, go to **Authentication → Users**
2. Click **Invite user** (or **Add user**) and enter their work email + a temporary password
3. Copy their **User UID** (shown in the users list)
4. Go to **SQL Editor → New Query** and run:

**For an IT Admin** (sees all tickets):
```sql
INSERT INTO public.user_roles (user_id, role, full_name)
VALUES ('paste-uid-here', 'admin', 'Jane Smith');
```

**For a Manager** (sees only their department):
```sql
INSERT INTO public.user_roles (user_id, role, department, full_name)
VALUES ('paste-uid-here', 'manager', 'Operations', 'Tom Bailey');
```

Department must exactly match one of: `Operations`, `Technology`, `Finance`, `Sales`, `Customer Service`, `HR & People`, `Leadership`, `Marketing`, `Warehouse`, `Driver / Field`

Repeat for each IT staff member.

---

## Step 3 — Configure the Front-End

Open `config.js` (in the root of the `hds-helpdesk` folder) and replace the two placeholder values:

```javascript
window.HDS_CONFIG = {
  SUPABASE_URL:      'https://YOUR_PROJECT_ID.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',
};
```

Use the **Project URL** and **anon / public** key from Step 1. This is the only file you edit — both the login and admin pages read from it. (The anon key is safe to expose publicly; never put the `service_role` key here.)

---

## Step 4 — Deploy to Netlify

1. Go to [netlify.com](https://netlify.com) and sign in
2. Click **Add new site → Deploy manually**
3. Drag the entire `hds-helpdesk` folder into the upload box
4. Netlify will give you a URL like `amazing-alpaca-123.netlify.app` — you can rename this under **Site Settings → General**

---

## Step 5 — Set Environment Variables

In Netlify, go to **Site Settings → Environment Variables** and add:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Your Supabase Project URL (from Step 1) |
| `SUPABASE_SERVICE_ROLE_KEY` | Your service_role key (from Step 1) |
| `SENDGRID_API_KEY` | Your SendGrid API key (Settings → API Keys → Full Access or Mail Send) |
| `EMAIL_FROM` | `helpdesk@homedelivery.com.au` (must be verified in SendGrid) |
| `IT_SUPPORT_EMAIL` | `itsupporttickets@hdsau.com.au` |

After adding variables, go to **Deploys → Trigger deploy** to pick them up.

---

## Step 6 — Verify SendGrid Sender

The `EMAIL_FROM` address must be verified in SendGrid or emails will fail silently.

1. In SendGrid go to **Settings → Sender Authentication**
2. If the `homedelivery.com.au` domain is already authenticated, you're done
3. If not, click **Authenticate Your Domain** and follow the DNS steps (requires adding a few DNS records — your IT team can do this)

---

## Step 7 — Test It

1. Open your Netlify URL in a browser
2. Submit a test ticket as a staff member — check that `itsupporttickets@hdsau.com.au` receives the email
3. Go to `/login` and sign in with one of the IT staff accounts created in Step 2
4. Confirm you can see tickets, change status, add notes

---

## Ongoing Admin

**Adding a new IT staff member:**
- Create them in Supabase → Authentication → Users
- Run the INSERT query from Step 2

**Removing access:**
- In Supabase → Authentication → Users, click the user and select **Delete user**

**Changing the IT support email:**
- Update the `IT_SUPPORT_EMAIL` environment variable in Netlify

**Custom domain** (e.g. `helpdesk.homedelivery.com.au`):
- Netlify → Site Settings → Domain Management → Add custom domain
- Add a CNAME record in your DNS pointing to the Netlify URL

---

## File Reference

```
hds-helpdesk/
├── index.html                        Staff portal (submit + view tickets)
├── login.html                        IT staff login page
├── admin.html                        Admin & manager dashboard
├── styles.css                        Shared HDS styling
├── netlify.toml                      Netlify configuration
├── package.json                      Node.js dependencies
├── supabase-setup.sql                Run this once in Supabase SQL Editor
└── netlify/
    └── functions/
        ├── submit-ticket.js          Creates ticket + sends email
        └── my-tickets.js            Returns tickets by email (staff lookup)
```

---

## Support

Contact Jordan Muir (jordan.muir@homedelivery.com.au) with any questions about this system.
