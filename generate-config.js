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