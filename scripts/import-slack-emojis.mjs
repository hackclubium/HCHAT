import { createClient } from '@supabase/supabase-js';

const slackToken = process.env.SLACK_BOT_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!slackToken || !supabaseUrl || !serviceRoleKey) {
  console.error('Missing SLACK_BOT_TOKEN, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const response = await fetch('https://slack.com/api/emoji.list', {
  headers: { Authorization: `Bearer ${slackToken}` },
});
const payload = await response.json();

if (!payload.ok) {
  console.error(`Slack emoji.list failed: ${payload.error}`);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

let createdBy = process.env.SUPABASE_IMPORT_USER_ID;
if (!createdBy) {
  const admin = await supabase.from('profiles').select('id').eq('role', 'admin').limit(1).maybeSingle();
  const fallback = admin.data || (await supabase.from('profiles').select('id').limit(1).maybeSingle()).data;
  createdBy = fallback?.id;
}

if (!createdBy) {
  console.error('No profile found. Sign in once or set SUPABASE_IMPORT_USER_ID to a profiles.id value.');
  process.exit(1);
}

const rowsByName = new Map();

for (const [slackName, image_url] of Object.entries(payload.emoji)) {
  if (typeof image_url !== 'string' || image_url.startsWith('alias:')) continue;
  const name = slackName.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 32);
  if (!/^[a-z0-9_]{2,32}$/.test(name)) continue;
  rowsByName.set(name, { name, image_url, created_by: createdBy });
}

const rows = [...rowsByName.values()];

for (let index = 0; index < rows.length; index += 500) {
  const batch = rows.slice(index, index + 500);
  const { error } = await supabase.from('emojis').upsert(batch, { onConflict: 'name' });
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log(`Imported ${Math.min(index + batch.length, rows.length)}/${rows.length}`);
}

console.log('Done.');
