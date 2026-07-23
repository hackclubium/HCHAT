-- Run this once if the app was set up before invite-gate removal.
-- It approves current users and updates the signup trigger so HCA users can post.

alter table public.profiles alter column approved set default true;

update public.profiles
set approved = true;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, approved)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), 'hackclubber'),
    true
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    approved = true;
  return new;
end;
$$;

insert into public.channels (name, topic)
values ('general', 'Main chat')
on conflict do nothing;

drop policy if exists "create own profile" on public.profiles;
create policy "create own profile" on public.profiles for insert to authenticated with check (id = auth.uid());
grant insert on public.profiles to authenticated;
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- Reactions accept uploaded emoji names and literal Unicode emoji.
alter table public.reactions drop constraint if exists reactions_emoji_name_check;
alter table public.reactions add constraint reactions_emoji_name_check check (char_length(emoji_name) between 1 and 64);

-- Receipts are private. Without this filter, one channel can return several users'
-- receipts and make the client treat every existing message as unread.
drop policy if exists "read own receipts" on public.read_receipts;
create policy "read own receipts" on public.read_receipts for select to authenticated
using (user_id = auth.uid() and public.can_access_channel(channel_id));
