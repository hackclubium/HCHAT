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
