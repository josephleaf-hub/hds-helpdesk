# HDS IT Helpdesk — Migration to VS Code Workflow

**Goal:** move from drag-and-drop Netlify deploys to a proper development environment with git version control, GitHub backup, auto-deploy on push, local preview, and Claude Code integration.

**Time:** 60-90 minutes for setup, one-time.

**What does NOT change:** the live URL, the Supabase database, the SendGrid account, the env vars, any tickets already in the system. This is purely about how you edit and deploy code.

---

## Before you start

Make sure you have:

- Your local `hds-helpdesk` folder (the one you've been dragging into Netlify) with your edited `config.js` containing your real Supabase URL and anon key
- Login access to your Netlify account
- Login access to your Supabase account
- A free GitHub account — sign up at github.com if you don't have one (use your work email, takes 2 minutes)

---

## Step 1 — Install the tools (15 min)

### 1a. VS Code

Download from https://code.visualstudio.com, install, open. That's it.

Once open, install one extension that makes git much easier to use visually:
- Open the Extensions panel (left sidebar, square icon)
- Search **GitLens** by GitKraken → Install

### 1b. GitHub Desktop

Download from https://desktop.github.com, install, sign in with your GitHub account. This gives you a friendly UI for git so you don't need to learn command-line git on day one.

### 1c. Node.js

Download the **LTS** version from https://nodejs.org, install. Accept all defaults.

Verify it worked: open VS Code, go to Terminal menu → New Terminal. Type:
```
node --version
```
Should show something like `v20.x.x` or `v22.x.x`.

### 1d. Netlify CLI

In that same VS Code terminal:
```
npm install -g netlify-cli
```

Verify:
```
netlify --version
```

---

## Step 2 — Put your project in git (10 min)

### 2a. Create the .gitignore file

In VS Code: File → Open Folder → select your `hds-helpdesk` folder.

In the file explorer (left side), right-click in empty space → New File → name it `.gitignore` (with the leading dot).

Paste this into it and save:

```
# Dependencies
node_modules/

# Local env files
.env
.env.local

# Netlify local state
.netlify/

# OS
.DS_Store
Thumbs.db

# Editor
.vscode/

# Credentials — config.js is regenerated at build time from env vars
config.js
```

### 2b. Create the config template

The real `config.js` is now ignored by git (so your keys don't end up on GitHub). We need a placeholder so people cloning the repo know what to fill in.

Right-click in the file explorer → New File → name it `config.example.js`. Paste:

```javascript
/* Copy this file to config.js and fill in real values from Supabase.
   The deployed version is generated automatically by Netlify from env vars —
   you only edit config.js for local development. */
window.HDS_CONFIG = {
  SUPABASE_URL:      'https://YOUR_PROJECT_ID.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',
};
```

### 2c. Add the build-time config generator

This is the magic that makes deploys work without `config.js` in the repo. Netlify will create `config.js` from env vars during each build.

Open your existing `netlify.toml` file in VS Code and replace its contents with:

```toml
[build]
  publish  = "."
  functions = "netlify/functions"
  command  = "node generate-config.js"

[functions]
  node_bundler = "esbuild"

[[redirects]]
  from   = "/api/*"
  to     = "/.netlify/functions/:splat"
  status = 200

[[redirects]]
  from   = "/login"
  to     = "/login.html"
  status = 200

[[redirects]]
  from   = "/admin"
  to     = "/admin.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options        = "SAMEORIGIN"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy        = "strict-origin-when-cross-origin"
```

The only new line is `command = "node generate-config.js"`.

Now create that script. New file → name it `generate-config.js`. Paste:

```javascript
// Runs during Netlify build to write config.js from env vars.
// Keeps real keys out of the repo.
const fs = require('fs');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY_PUBLIC;

if (!url || !key) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_ANON_KEY_PUBLIC must be set in Netlify env vars');
  process.exit(1);
}

const contents = `window.HDS_CONFIG = {
  SUPABASE_URL:      ${JSON.stringify(url)},
  SUPABASE_ANON_KEY: ${JSON.stringify(key)},
};
`;

fs.writeFileSync('config.js', contents);
console.log('✓ config.js generated for deploy');
```

### 2d. Add the new env var to Netlify

The build script needs `SUPABASE_ANON_KEY_PUBLIC`. It's the same value as the `SUPABASE_ANON_KEY` from your `config.js`.

- Netlify dashboard → your site → Site configuration → Environment variables → Add a variable
- Key: `SUPABASE_ANON_KEY_PUBLIC`
- Value: paste your anon key (the long `eyJ...` from Supabase → Legacy keys → anon)
- **Do NOT** tick "Contains secret values" (anon key is safe to expose)
- All scopes, same value for all contexts → Create

### 2e. Initialise the git repository

- Open GitHub Desktop
- File menu → Add Local Repository → browse to your `hds-helpdesk` folder
- It will say "This directory does not appear to be a Git repository" → click **create a repository** link
- Name: `hds-helpdesk`
- Description: `HDS internal IT helpdesk system`
- Leave everything else default → Create Repository

You should now see all your files listed as "changes." In the bottom-left, type a commit message:

> v1.1 baseline — working in production

Click **Commit to main**.

### 2f. Publish to GitHub

Click **Publish repository** at the top.

- Name: `hds-helpdesk`
- **Tick "Keep this code private"** (very important — your code stays private to your account)
- Click **Publish Repository**

Your code is now backed up on GitHub. You can verify by going to github.com — you'll see the repo on your profile.

---

## Step 3 — Connect Netlify to GitHub (5 min)

Right now your Netlify site is "manual deploy" (drag-and-drop). We need to link it to the GitHub repo so it auto-deploys on every push.

- Netlify dashboard → your site
- Site configuration → Build & deploy → Continuous deployment → **Link site to Git**
- Pick **GitHub** → authorise Netlify (one-time browser popup)
- Select the `hds-helpdesk` repository
- Branch to deploy: `main`
- Build command: leave whatever's there (Netlify reads it from netlify.toml)
- Publish directory: `.`
- Save

Netlify will immediately kick off a deploy. Watch the **Deploys** tab — you should see a new build starting. It runs `node generate-config.js`, creates `config.js` from your env var, bundles your serverless functions, and publishes. Should be green in 60 seconds.

**Verify it worked:** open your live URL, submit a test ticket. Should work exactly as before — because nothing about how the site runs has changed, just how it deploys.

---

## Step 4 — Local development with `netlify dev` (5 min)

Now the fun part. Open VS Code terminal again. Make sure you're in the project folder.

```
netlify link
```

Pick "Use current git remote origin" or search by name for `hds-helpdesk`. This links your local folder to your Netlify site, so the CLI knows which env vars to pull.

Now run:

```
netlify dev
```

This starts a local server at `http://localhost:8888` that:

- Serves your HTML pages
- Runs your serverless functions locally (calling SendGrid and Supabase for real)
- Pulls your env vars from Netlify automatically (you don't need a local .env file)
- Auto-reloads when you save a file

Open `http://localhost:8888` in your browser. The whole site should work — submit tickets, log in as admin, send replies. It's hitting your real production Supabase and real SendGrid, just running from your local code.

**The dev workflow from now on:**

1. Edit files in VS Code, save
2. Refresh the browser at localhost:8888 to see changes
3. When something works, open GitHub Desktop, write a commit message, click Commit to main
4. Click **Push origin**
5. Netlify auto-deploys to production in 30 seconds

If you ever break production, Netlify keeps every deploy. Go to Deploys tab → find the last good one → click "Publish deploy" → reverted in 5 seconds.

---

## Step 5 — Install Claude Code (10 min)

This is what makes everything fast. Claude Code is a CLI version of Claude that lives in your terminal, reads your project files, and can make code changes directly with diff review.

```
npm install -g @anthropic-ai/claude-code
```

In your project folder:

```
claude
```

It'll prompt you to sign in with your Claude account (same one you use here). Done.

Now you can say things like:

> "Read send-message.js and explain why the email might be going to spam. Check the actual headers we're sending."

And it does. Reads the file, looks up SendGrid best practices, suggests fixes, shows you the diff before applying.

---

## Step 6 — Hand off to Claude Code (2 min)

Open the file called **HANDOFF.md** (the second file I'm giving you alongside this runbook). Copy its entire contents.

In your VS Code terminal, with `claude` running, paste it as your first message. That gives Claude Code complete context — what was built, what's working, what's broken, what to investigate first.

From there, you work in the new environment.

---

## What you've gained

- Every file change is tracked, attributable, reversible
- Production breaks → one-click rollback to the last good deploy
- Backed up on GitHub — laptop death no longer threatens the project
- Real local dev environment — test things before they touch production
- Claude Code lives in your project, reads your real files, edits with diffs
- The next person (Jordan, a contractor, future-you) can clone the repo, run `netlify link && netlify dev`, and be productive in 5 minutes

## What you've NOT lost

- Live URL unchanged
- All env vars still there
- Database unchanged
- Every existing ticket preserved
- The HDS design system (the `hds-dash` skill) applies just as well in Claude Code

## When things go wrong (common gotchas)

- **Netlify build fails after linking to git** → almost always the env var. Make sure `SUPABASE_ANON_KEY_PUBLIC` is set, not just `SUPABASE_URL`.
- **`netlify dev` says "no functions found"** → run it from the project root, not a subdirectory.
- **Pushed to GitHub but no auto-deploy** → check Netlify → Deploys → make sure "Auto publishing" is enabled.
- **config.js missing locally after pulling from git** → expected, it's gitignored. Copy `config.example.js` to `config.js` and fill in your values for local dev.