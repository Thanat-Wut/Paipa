create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  name text not null check (char_length(name) between 2 and 80),
  description text not null default '',
  destination text not null default '',
  cover_url text,
  start_date date not null,
  end_date date not null,
  budget_per_person numeric(12,2) not null default 0 check (budget_per_person >= 0),
  max_members integer not null default 8 check (max_members between 2 and 100),
  status text not null default 'planning' check (status in ('planning','upcoming','ongoing','completed','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_trip_dates check (end_date >= start_date)
);

create table public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  avatar_url text,
  avatar_type text not null default 'emoji' check (avatar_type in ('emoji','image','gif')),
  signature_path text,
  attendance text not null default 'going' check (attendance in ('going','maybe','not_going')),
  role text not null default 'member' check (role in ('owner','member','guest')),
  joined_at timestamptz not null default now(),
  unique (trip_id, user_id)
);

create table public.trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Za-z0-9_-]{6,32}$'),
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  usage_count integer not null default 0 check (usage_count >= 0),
  created_at timestamptz not null default now()
);

create index trip_members_user_idx on public.trip_members(user_id);
create index trip_invites_trip_idx on public.trip_invites(trip_id);

create function private.check_trip_capacity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.max_members < (select count(*) from public.trip_members where trip_id = new.id) then
    raise exception 'Maximum members cannot be below the current roster';
  end if;
  return new;
end;
$$;

create trigger check_trip_capacity before update of max_members on public.trips
for each row execute function private.check_trip_capacity();

create function private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, left(coalesce(nullif(split_part(new.email, '@', 1), ''), 'เพื่อนใหม่'), 60));
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function private.create_profile();

create function private.is_trip_member(p_trip_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and user_id = (select auth.uid())
  );
$$;

create function private.is_trip_owner(p_trip_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.trips
    where id = p_trip_id and owner_id = (select auth.uid())
  );
$$;

revoke all on function private.is_trip_member(uuid) from public;
revoke all on function private.is_trip_owner(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_trip_member(uuid), private.is_trip_owner(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_invites enable row level security;

create policy "profile self read" on public.profiles for select to authenticated
using (id = (select auth.uid()));
create policy "profile self update" on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "member trip read" on public.trips for select to authenticated
using (owner_id = (select auth.uid()) or private.is_trip_member(id));
create policy "owner trip update" on public.trips for update to authenticated
using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "owner trip delete" on public.trips for delete to authenticated
using (owner_id = (select auth.uid()));

create policy "member roster read" on public.trip_members for select to authenticated
using (private.is_trip_member(trip_id));

create policy "owner invite read" on public.trip_invites for select to authenticated
using (private.is_trip_owner(trip_id));
create policy "owner invite insert" on public.trip_invites for insert to authenticated
with check (created_by = (select auth.uid()) and private.is_trip_owner(trip_id));
create policy "owner invite delete" on public.trip_invites for delete to authenticated
using (private.is_trip_owner(trip_id));

grant select, update on public.profiles to authenticated;
grant select, update, delete on public.trips to authenticated;
grant select on public.trip_members to authenticated;
grant select, insert, delete on public.trip_invites to authenticated;

create function public.create_trip(
  p_name text, p_description text, p_destination text,
  p_start_date date, p_end_date date, p_budget_per_person numeric,
  p_max_members integer
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_trip_id uuid; v_name text;
begin
  if (select auth.uid()) is null then raise exception 'Login required'; end if;
  v_name := btrim(p_name);
  if char_length(v_name) not between 2 and 80 or p_end_date < p_start_date
     or p_budget_per_person < 0 or p_max_members not between 2 and 100 then
    raise exception 'Invalid trip data';
  end if;
  insert into public.trips(owner_id, name, description, destination, start_date, end_date, budget_per_person, max_members)
  values ((select auth.uid()), v_name, coalesce(p_description,''), coalesce(p_destination,''), p_start_date, p_end_date, p_budget_per_person, p_max_members)
  returning id into v_trip_id;
  insert into public.trip_members(trip_id, user_id, display_name, role)
  select v_trip_id, id, display_name, 'owner' from public.profiles where id = (select auth.uid());
  return v_trip_id;
end;
$$;

create function public.preview_invite(p_code text)
returns table(trip_id uuid, trip_name text, destination text, start_date date, end_date date, member_count bigint, max_members integer)
language sql stable security definer set search_path = '' as $$
  select t.id, t.name, t.destination, t.start_date, t.end_date,
    (select count(*) from public.trip_members m where m.trip_id = t.id), t.max_members
  from public.trip_invites i join public.trips t on t.id = i.trip_id
  where i.code = p_code and (i.expires_at is null or i.expires_at > now())
    and (i.max_uses is null or i.usage_count < i.max_uses)
    and t.status <> 'archived';
$$;

create function public.join_trip(p_code text, p_display_name text, p_avatar_type text, p_avatar_url text, p_signature_path text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_invite public.trip_invites%rowtype; v_trip public.trips%rowtype; v_count bigint;
begin
  if (select auth.uid()) is null then raise exception 'Login required'; end if;
  if char_length(btrim(p_display_name)) not between 1 and 60 or p_avatar_type not in ('emoji','image','gif') then
    raise exception 'Invalid member profile';
  end if;
  if p_signature_path is null or p_signature_path = '' or
     split_part(p_signature_path, '/', 1) <> (select auth.uid())::text or
     not exists(select 1 from storage.objects where bucket_id = 'signatures' and name = p_signature_path) then
    raise exception 'Valid signature required';
  end if;
  select * into v_invite from public.trip_invites where code = p_code for update;
  if not found or (v_invite.expires_at is not null and v_invite.expires_at <= now())
     or (v_invite.max_uses is not null and v_invite.usage_count >= v_invite.max_uses) then
    raise exception 'Invite is invalid or expired';
  end if;
  select * into v_trip from public.trips where id = v_invite.trip_id for update;
  if v_trip.status = 'archived' then raise exception 'Trip is archived'; end if;
  if exists(select 1 from public.trip_members where trip_id = v_trip.id and user_id = (select auth.uid())) then
    return v_trip.id;
  end if;
  select count(*) into v_count from public.trip_members where trip_id = v_trip.id;
  if v_count >= v_trip.max_members then raise exception 'Trip is full'; end if;
  insert into public.trip_members(trip_id, user_id, display_name, avatar_type, avatar_url, signature_path)
  values (v_trip.id, (select auth.uid()), btrim(p_display_name), p_avatar_type, nullif(p_avatar_url,''), nullif(p_signature_path,''));
  update public.trip_invites set usage_count = usage_count + 1 where id = v_invite.id;
  return v_trip.id;
end;
$$;

create function public.update_member_profile(p_trip_id uuid, p_display_name text, p_avatar_type text, p_avatar_url text, p_signature_path text, p_attendance text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Login required'; end if;
  if char_length(btrim(p_display_name)) not between 1 and 60 or p_avatar_type not in ('emoji','image','gif')
     or p_attendance not in ('going','maybe','not_going') then raise exception 'Invalid member profile'; end if;
  if p_signature_path is not null and p_signature_path <> '' and
     (split_part(p_signature_path, '/', 1) <> (select auth.uid())::text or
      not exists(select 1 from storage.objects where bucket_id = 'signatures' and name = p_signature_path)) then
    raise exception 'Invalid signature path'; end if;
  update public.trip_members set display_name = btrim(p_display_name), avatar_type = p_avatar_type,
    avatar_url = nullif(p_avatar_url,''), signature_path = nullif(p_signature_path,''), attendance = p_attendance
  where trip_id = p_trip_id and user_id = (select auth.uid());
  if not found then raise exception 'Not a trip member'; end if;
end;
$$;

create function public.leave_trip(p_trip_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.trip_members where trip_id = p_trip_id and user_id = (select auth.uid()) and role <> 'owner';
  if not found then raise exception 'Cannot leave this trip'; end if;
end;
$$;

revoke all on function public.create_trip(text,text,text,date,date,numeric,integer) from public;
revoke all on function public.preview_invite(text) from public;
revoke all on function public.join_trip(text,text,text,text,text) from public;
revoke all on function public.update_member_profile(uuid,text,text,text,text,text) from public;
revoke all on function public.leave_trip(uuid) from public;
grant execute on function public.create_trip(text,text,text,date,date,numeric,integer),
  public.join_trip(text,text,text,text,text), public.update_member_profile(uuid,text,text,text,text,text),
  public.leave_trip(uuid) to authenticated;
grant execute on function public.preview_invite(text) to anon, authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('signatures', 'signatures', false, 2097152, array['image/png']),
       ('avatars', 'avatars', true, 5242880, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do nothing;

create policy "user uploads own signature" on storage.objects for insert to authenticated
with check (bucket_id = 'signatures' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "user reads own signature" on storage.objects for select to authenticated
using (bucket_id = 'signatures' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "user uploads own avatar" on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "public avatar read" on storage.objects for select to anon, authenticated
using (bucket_id = 'avatars');
