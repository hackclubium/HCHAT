# HCHAT

Hack Club chatting app. Text channels + custom emojis. Static frontend deploys to GitHub Pages. Supabase provides auth, Postgres, realtime, storage.

## Setup

1. Create a Supabase project.
2. In Supabase SQL editor, run `supabase/schema.sql`.
3. Copy `.env.example` to `.env` and fill `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.
4. Run `npm install`.
5. Run `npm run dev`.

## GitHub Pages

Add repository secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Then enable Pages source: GitHub Actions.

## Scope

Built now:

- magic-link login
- public channels
- profile display names
- Hack Club Auth login
- admin/mod-only channel creation/deletion
- public/private channels
- private channel membership controls
- admin/mod channel topic editing
- realtime text messages
- file attachments up to 10MB
- read receipts table
- unread channel counts
- direct messages
- threads
- pinned messages
- message editing
- message edit history table
- emoji reactions
- message search
- message deletion by author/mod/admin
- timeouts and bans
- audit log for key staff actions
- custom emoji upload/rendering with `:emoji_name:`
- emoji deletion by uploader/mod/admin

## First Admin

After first login, promote yourself in Supabase SQL:

```sql
update public.profiles
set role = 'admin', approved = true
where email = 'you@example.com';
```

If you set up Supabase before HCA/invite removal, run:

```txt
supabase/fix-existing-db.sql
```

Skipped for MVP:

- voice/video
- mobile push
