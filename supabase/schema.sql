create type public.member_role as enum ('member', 'mod', 'admin');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null check (char_length(display_name) between 2 and 40),
  role public.member_role not null default 'member',
  approved boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name ~ '^[a-z0-9_-]{2,32}$'),
  topic text not null default '' check (char_length(topic) <= 160),
  private boolean not null default false,
  archived boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  body text not null check (char_length(body) between 1 and 2000),
  parent_id uuid references public.messages(id) on delete cascade,
  attachment_url text,
  attachment_name text,
  attachment_type text,
  pinned boolean not null default false,
  deleted_at timestamptz,
  edited_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.message_edits (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  editor_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  old_body text not null,
  new_body text not null,
  created_at timestamptz not null default now()
);

create table public.channel_members (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create table public.reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  emoji_name text not null check (emoji_name ~ '^[a-z0-9_]{2,32}$'),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji_name)
);

create table public.moderation (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  banned boolean not null default false,
  timeout_until timestamptz,
  reason text not null default '' check (char_length(reason) <= 200),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.dm_conversations (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.dm_members (
  conversation_id uuid not null references public.dm_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dm_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table public.read_receipts (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  last_read_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null default auth.uid(),
  action text not null check (char_length(action) between 2 and 80),
  target text not null default '' check (char_length(target) <= 160),
  created_at timestamptz not null default now()
);

create table public.emojis (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name ~ '^[a-z0-9_]{2,32}$'),
  image_url text not null,
  created_by uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now()
);

create index messages_channel_created_idx on public.messages (channel_id, created_at desc);
create index messages_parent_created_idx on public.messages (parent_id, created_at) where parent_id is not null;
create index messages_pinned_idx on public.messages (channel_id, pinned, created_at desc) where pinned;
create index messages_search_idx on public.messages using gin (to_tsvector('english', body));
create index message_edits_message_created_idx on public.message_edits (message_id, created_at desc);
create index dm_messages_conversation_created_idx on public.dm_messages (conversation_id, created_at desc);

create function public.is_staff(user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.profiles where id = user_id and role in ('mod', 'admin'));
$$;

create function public.is_approved(user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.profiles where id = user_id and approved);
$$;

create function public.is_dm_member(conversation_id uuid, user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.dm_members where dm_members.conversation_id = is_dm_member.conversation_id and dm_members.user_id = is_dm_member.user_id);
$$;

create function public.can_access_channel(channel_id uuid, user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_approved(user_id) and exists (
    select 1 from public.channels
    where id = channel_id
      and (not private or public.is_staff(user_id) or exists (
        select 1 from public.channel_members
        where channel_members.channel_id = can_access_channel.channel_id
          and channel_members.user_id = can_access_channel.user_id
      ))
  );
$$;

create function public.can_post(user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_approved(user_id) and not exists (
    select 1 from public.moderation
    where moderation.user_id = can_post.user_id
      and (banned or coalesce(timeout_until, '-infinity'::timestamptz) > now())
  );
$$;

create function public.create_dm(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation uuid;
begin
  if not public.can_post() or other_user_id = auth.uid() then
    raise exception 'not allowed';
  end if;

  select dm_members.conversation_id into conversation
  from public.dm_members
  where user_id in (auth.uid(), other_user_id)
  group by dm_members.conversation_id
  having count(distinct user_id) = 2
  limit 1;

  if conversation is not null then
    return conversation;
  end if;

  insert into public.dm_conversations default values returning id into conversation;
  insert into public.dm_members (conversation_id, user_id) values (conversation, auth.uid()), (conversation, other_user_id);
  return conversation;
end;
$$;

create function public.edit_message(message_id uuid, new_body text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  old text;
begin
  if char_length(trim(new_body)) < 1 or char_length(new_body) > 2000 then
    raise exception 'invalid message length';
  end if;

  select body into old from public.messages where id = message_id and user_id = auth.uid();
  if old is null then
    return false;
  end if;

  insert into public.message_edits (message_id, old_body, new_body) values (message_id, old, new_body);
  update public.messages set body = new_body, edited_at = now() where id = message_id;
  return true;
end;
$$;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, approved)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), true)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.channels enable row level security;
alter table public.channel_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_edits enable row level security;
alter table public.reactions enable row level security;
alter table public.moderation enable row level security;
alter table public.dm_conversations enable row level security;
alter table public.dm_members enable row level security;
alter table public.dm_messages enable row level security;
alter table public.read_receipts enable row level security;
alter table public.audit_logs enable row level security;
alter table public.emojis enable row level security;

create policy "read profiles" on public.profiles for select to authenticated using (public.is_approved() or id = auth.uid());
create policy "create own profile" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "read channels" on public.channels for select to authenticated using (public.can_access_channel(id) and (not archived or public.is_staff()));
create policy "staff create channels" on public.channels for insert to authenticated with check (public.is_staff());
create policy "staff update channels" on public.channels for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff delete channels" on public.channels for delete to authenticated using (public.is_staff());

create policy "read channel members" on public.channel_members for select to authenticated using (public.can_access_channel(channel_id));
create policy "staff write channel members" on public.channel_members for insert to authenticated with check (public.is_staff());
create policy "staff delete channel members" on public.channel_members for delete to authenticated using (public.is_staff());

create policy "read messages" on public.messages for select to authenticated using (public.can_access_channel(channel_id));
create policy "send messages" on public.messages for insert to authenticated with check (user_id = auth.uid() and public.can_post() and public.can_access_channel(channel_id));
create policy "staff pin messages" on public.messages for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "delete own or staff messages" on public.messages for delete to authenticated using (user_id = auth.uid() or public.is_staff());

create policy "read own or staff edits" on public.message_edits for select to authenticated using (editor_id = auth.uid() or public.is_staff());

create policy "read reactions" on public.reactions for select to authenticated using (true);
create policy "react if allowed" on public.reactions for insert to authenticated with check (user_id = auth.uid() and public.can_post());
create policy "delete own reactions" on public.reactions for delete to authenticated using (user_id = auth.uid());

create policy "staff read moderation" on public.moderation for select to authenticated using (public.is_staff() or user_id = auth.uid());
create policy "staff write moderation" on public.moderation for insert to authenticated with check (public.is_staff());
create policy "staff update moderation" on public.moderation for update to authenticated using (public.is_staff()) with check (public.is_staff());

create policy "read own dms" on public.dm_conversations for select to authenticated using (public.is_dm_member(id));
create policy "read own dm members" on public.dm_members for select to authenticated using (public.is_dm_member(conversation_id));
create policy "read own dm messages" on public.dm_messages for select to authenticated using (public.is_dm_member(conversation_id));
create policy "send own dm messages" on public.dm_messages for insert to authenticated with check (user_id = auth.uid() and public.is_dm_member(conversation_id) and public.can_post());
create policy "delete own dm messages" on public.dm_messages for delete to authenticated using (user_id = auth.uid());

create policy "read own receipts" on public.read_receipts for select to authenticated using (public.can_access_channel(channel_id));
create policy "upsert own receipts" on public.read_receipts for insert to authenticated with check (user_id = auth.uid() and public.can_access_channel(channel_id));
create policy "update own receipts" on public.read_receipts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "staff read audit" on public.audit_logs for select to authenticated using (public.is_staff());
create policy "staff write audit" on public.audit_logs for insert to authenticated with check (public.is_staff());

create policy "read emojis" on public.emojis for select to authenticated using (true);
create policy "add emojis" on public.emojis for insert to authenticated with check (created_by = auth.uid());
create policy "delete own or staff emojis" on public.emojis for delete to authenticated using (created_by = auth.uid() or public.is_staff());

insert into public.channels (name, topic) values
  ('general', 'Main chat'),
  ('random', 'Off-topic'),
  ('help', 'Ask for help')
on conflict do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('emojis', 'emojis', true, 1048576, array['image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "read emoji files" on storage.objects for select to authenticated using (bucket_id = 'emojis');
create policy "upload emoji files" on storage.objects for insert to authenticated with check (bucket_id = 'emojis');
create policy "delete emoji files" on storage.objects for delete to authenticated using (bucket_id = 'emojis');

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', true, 10485760)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

create policy "read attachments" on storage.objects for select to authenticated using (bucket_id = 'attachments');
create policy "upload attachments" on storage.objects for insert to authenticated with check (bucket_id = 'attachments' and public.can_post());

grant select on public.profiles, public.channels, public.channel_members, public.messages, public.message_edits, public.reactions, public.moderation, public.dm_conversations, public.dm_members, public.dm_messages, public.read_receipts, public.audit_logs, public.emojis to authenticated;
grant insert on public.profiles, public.channels, public.channel_members, public.messages, public.reactions, public.moderation, public.dm_messages, public.read_receipts, public.audit_logs, public.emojis to authenticated;
grant update on public.channels, public.messages, public.moderation, public.read_receipts to authenticated;
grant delete on public.channels, public.channel_members, public.messages, public.reactions, public.dm_messages, public.emojis to authenticated;
grant execute on function public.create_dm(uuid), public.edit_message(uuid, text) to authenticated;
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.reactions;
alter publication supabase_realtime add table public.dm_messages;
alter publication supabase_realtime add table public.channels;
alter publication supabase_realtime add table public.read_receipts;
alter publication supabase_realtime add table public.emojis;
