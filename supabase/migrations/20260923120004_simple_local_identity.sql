-- Move the M1 application identity from auth.users to browser-created UUIDs.
-- Existing profile/trip/member/invite UUIDs are kept in place.

do $$
declare v_fk record;
begin
  for v_fk in
    select conname
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and confrelid = 'auth.users'::regclass
  loop
    execute format('alter table public.profiles drop constraint %I', v_fk.conname);
  end loop;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists private.create_profile();

-- Fail closed if legacy rows do not satisfy the current commitment invariant.
-- This avoids silently deleting a signature or changing a real member status.
do $$
begin
  if exists (
    select 1 from public.trip_members
    where not (
      (attendance = 'going' and signature_path is not null and commitment_signed_at is not null)
      or (attendance in ('maybe', 'not_going') and signature_path is null and commitment_signed_at is null)
    )
  ) then
    raise exception 'Existing trip_members rows violate the M1 commitment invariant; review data before applying local identity migration';
  end if;
end;
$$;

alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_invites enable row level security;

do $$
declare v_policy record;
begin
  for v_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'trips', 'trip_members', 'trip_invites')
  loop
    execute format('drop policy %I on %I.%I', v_policy.policyname, v_policy.schemaname, v_policy.tablename);
  end loop;
end;
$$;

revoke all on table public.profiles, public.trips, public.trip_members, public.trip_invites from public, anon, authenticated;
grant select, insert, update, delete on table public.profiles, public.trips, public.trip_members, public.trip_invites to service_role;

-- M1 data writes now pass through actor-aware RPCs using the server-only key.
drop function if exists public.create_trip(text, text, text, date, date, numeric, integer);
drop function if exists public.join_trip(text, text, text, text);
drop function if exists public.join_trip(text, text, text, text, text);
drop function if exists public.update_member_profile(uuid, text, text, text, text, text);
drop function if exists public.leave_trip(uuid);
drop function if exists private.is_trip_member(uuid);
drop function if exists private.is_trip_owner(uuid);
drop function if exists public.create_trip(uuid, text, text, text, date, date, numeric, integer);
drop function if exists public.create_invite(uuid, uuid, text, timestamptz);
drop function if exists public.join_trip(uuid, text, text, text, text);
drop function if exists public.update_member_profile(uuid, uuid, text, text, text, text, text);
drop function if exists public.leave_trip(uuid, uuid);
drop function if exists public.update_trip(uuid, uuid, text, text, text, date, date, numeric, integer);
drop function if exists public.archive_trip(uuid, uuid);
drop function if exists public.delete_trip(uuid, uuid);

create or replace function public.preview_invite(p_code text)
returns table(
  trip_id uuid,
  trip_name text,
  destination text,
  start_date date,
  end_date date,
  member_count bigint,
  max_members integer
)
language sql stable security definer set search_path = '' as $$
  select t.id, t.name, t.destination, t.start_date, t.end_date,
    (select count(*) from public.trip_members m where m.trip_id = t.id), t.max_members
  from public.trip_invites i
  join public.trips t on t.id = i.trip_id
  where i.code = p_code
    and (i.expires_at is null or i.expires_at > now())
    and (i.max_uses is null or i.usage_count < i.max_uses)
    and t.status <> 'archived';
$$;

create function public.create_trip(
  p_actor_id uuid,
  p_name text,
  p_description text,
  p_destination text,
  p_start_date date,
  p_end_date date,
  p_budget_per_person numeric,
  p_max_members integer
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_trip_id uuid; v_name text; v_description text; v_destination text; v_display_name text;
begin
  select display_name into v_display_name from public.profiles where id = p_actor_id;
  if not found then raise exception 'Profile not found'; end if;

  v_name := btrim(coalesce(p_name, ''));
  v_description := btrim(coalesce(p_description, ''));
  v_destination := btrim(coalesce(p_destination, ''));
  if char_length(v_name) not between 2 and 80
     or char_length(v_description) > 500
     or char_length(v_destination) > 120
     or p_start_date is null or p_end_date is null or p_end_date < p_start_date
     or p_budget_per_person is null or p_budget_per_person not between 0 and 1000000
     or p_max_members is null or p_max_members not between 2 and 100 then
    raise exception 'Invalid trip data';
  end if;

  insert into public.trips(owner_id, name, description, destination, start_date, end_date, budget_per_person, max_members)
  values (p_actor_id, v_name, v_description, v_destination, p_start_date, p_end_date, p_budget_per_person, p_max_members)
  returning id into v_trip_id;

  insert into public.trip_members(trip_id, user_id, display_name, role, attendance)
  values (v_trip_id, p_actor_id, v_display_name, 'owner', 'maybe');
  return v_trip_id;
end;
$$;

create function public.create_invite(p_actor_id uuid, p_trip_id uuid, p_code text, p_expires_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_invite_id uuid;
begin
  if not exists(select 1 from public.trips where id = p_trip_id and owner_id = p_actor_id for update) then
    raise exception 'Trip owner required';
  end if;
  if p_code !~ '^[A-Za-z0-9_-]{6,32}$' or p_expires_at is null then
    raise exception 'Invalid invite';
  end if;
  insert into public.trip_invites(trip_id, code, created_by, expires_at)
  values (p_trip_id, p_code, p_actor_id, p_expires_at)
  returning id into v_invite_id;
  return v_invite_id;
end;
$$;

create function public.join_trip(p_actor_id uuid, p_code text, p_display_name text, p_avatar_type text, p_avatar_url text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_invite public.trip_invites%rowtype; v_trip public.trips%rowtype; v_count bigint;
begin
  if not exists(select 1 from public.profiles where id = p_actor_id) then raise exception 'Profile not found'; end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 60
     or p_avatar_type not in ('emoji', 'image', 'gif') then
    raise exception 'Invalid member profile';
  end if;

  select * into v_invite from public.trip_invites where code = p_code for update;
  if not found or (v_invite.expires_at is not null and v_invite.expires_at <= now())
     or (v_invite.max_uses is not null and v_invite.usage_count >= v_invite.max_uses) then
    raise exception 'Invite is invalid or expired';
  end if;
  select * into v_trip from public.trips where id = v_invite.trip_id for update;
  if not found or v_trip.status = 'archived' then raise exception 'Trip is archived'; end if;
  if exists(select 1 from public.trip_members where trip_id = v_trip.id and user_id = p_actor_id) then
    return v_trip.id;
  end if;
  select count(*) into v_count from public.trip_members where trip_id = v_trip.id;
  if v_count >= v_trip.max_members then raise exception 'Trip is full'; end if;

  insert into public.trip_members(trip_id, user_id, display_name, avatar_type, avatar_url, attendance)
  values (v_trip.id, p_actor_id, btrim(p_display_name), p_avatar_type,
    nullif(btrim(coalesce(p_avatar_url, '')), ''), 'maybe');
  update public.trip_invites set usage_count = usage_count + 1 where id = v_invite.id;
  return v_trip.id;
end;
$$;

create function public.update_member_profile(
  p_actor_id uuid,
  p_trip_id uuid,
  p_display_name text,
  p_avatar_type text,
  p_avatar_url text,
  p_signature_path text,
  p_attendance text
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_member public.trip_members%rowtype;
  v_signature_path text := nullif(btrim(coalesce(p_signature_path, '')), '');
  v_old_signature_path text;
  v_commitment_signed_at timestamptz;
begin
  if not exists(select 1 from public.profiles where id = p_actor_id) then raise exception 'Profile not found'; end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 60
     or p_avatar_type not in ('emoji', 'image', 'gif')
     or p_attendance not in ('going', 'maybe', 'not_going') then
    raise exception 'Invalid member profile';
  end if;
  select * into v_member from public.trip_members
  where trip_id = p_trip_id and user_id = p_actor_id for update;
  if not found then raise exception 'Not a trip member'; end if;

  v_old_signature_path := v_member.signature_path;
  if p_attendance = 'going' then
    if v_signature_path is null then raise exception 'Valid signature required'; end if;
    if split_part(v_signature_path, '/', 1) <> p_actor_id::text
       or not exists(select 1 from storage.objects where bucket_id = 'signatures' and name = v_signature_path) then
      raise exception 'Invalid signature path';
    end if;
    v_commitment_signed_at := case
      when v_member.attendance = 'going' and v_member.signature_path = v_signature_path
        then v_member.commitment_signed_at
      else now()
    end;
  else
    v_signature_path := null;
    v_commitment_signed_at := null;
  end if;

  update public.trip_members set
    display_name = btrim(p_display_name),
    avatar_type = p_avatar_type,
    avatar_url = nullif(btrim(coalesce(p_avatar_url, '')), ''),
    signature_path = v_signature_path,
    commitment_signed_at = v_commitment_signed_at,
    attendance = p_attendance
  where id = v_member.id;

  if v_old_signature_path is not null and v_old_signature_path <> coalesce(v_signature_path, '') then
    return v_old_signature_path;
  end if;
  return null;
end;
$$;

create function public.leave_trip(p_actor_id uuid, p_trip_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_member public.trip_members%rowtype;
begin
  select * into v_member from public.trip_members
  where trip_id = p_trip_id and user_id = p_actor_id for update;
  if not found or v_member.role = 'owner' then raise exception 'Cannot leave this trip'; end if;
  delete from public.trip_members where id = v_member.id;
  return v_member.signature_path;
end;
$$;

create function public.update_trip(
  p_actor_id uuid,
  p_trip_id uuid,
  p_name text,
  p_description text,
  p_destination text,
  p_start_date date,
  p_end_date date,
  p_budget_per_person numeric,
  p_max_members integer
) returns void language plpgsql security definer set search_path = '' as $$
declare v_name text; v_description text; v_destination text;
begin
  if not exists(select 1 from public.trips where id = p_trip_id and owner_id = p_actor_id for update) then
    raise exception 'Trip owner required';
  end if;
  v_name := btrim(coalesce(p_name, ''));
  v_description := btrim(coalesce(p_description, ''));
  v_destination := btrim(coalesce(p_destination, ''));
  if char_length(v_name) not between 2 and 80
     or char_length(v_description) > 500
     or char_length(v_destination) > 120
     or p_start_date is null or p_end_date is null or p_end_date < p_start_date
     or p_budget_per_person is null or p_budget_per_person not between 0 and 1000000
     or p_max_members is null or p_max_members not between 2 and 100 then
    raise exception 'Invalid trip data';
  end if;
  update public.trips set name=v_name, description=v_description, destination=v_destination,
    start_date=p_start_date, end_date=p_end_date, budget_per_person=p_budget_per_person,
    max_members=p_max_members, updated_at=now()
  where id=p_trip_id;
end;
$$;

create function public.archive_trip(p_actor_id uuid, p_trip_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.trips set status='archived', updated_at=now()
  where id=p_trip_id and owner_id=p_actor_id;
  if not found then raise exception 'Trip owner required'; end if;
end;
$$;

create function public.delete_trip(p_actor_id uuid, p_trip_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.trips where id=p_trip_id and owner_id=p_actor_id;
  if not found then raise exception 'Trip owner required'; end if;
end;
$$;

revoke all on function public.preview_invite(text) from public;
grant execute on function public.preview_invite(text) to anon, authenticated, service_role;

revoke all on function public.create_trip(uuid, text, text, text, date, date, numeric, integer) from public, anon, authenticated;
revoke all on function public.create_invite(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.join_trip(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.update_member_profile(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.leave_trip(uuid, uuid) from public, anon, authenticated;
revoke all on function public.update_trip(uuid, uuid, text, text, text, date, date, numeric, integer) from public, anon, authenticated;
revoke all on function public.archive_trip(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_trip(uuid, uuid) from public, anon, authenticated;

grant execute on function public.create_trip(uuid, text, text, text, date, date, numeric, integer) to service_role;
grant execute on function public.create_invite(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.join_trip(uuid, text, text, text, text) to service_role;
grant execute on function public.update_member_profile(uuid, uuid, text, text, text, text, text) to service_role;
grant execute on function public.leave_trip(uuid, uuid) to service_role;
grant execute on function public.update_trip(uuid, uuid, text, text, text, date, date, numeric, integer) to service_role;
grant execute on function public.archive_trip(uuid, uuid) to service_role;
grant execute on function public.delete_trip(uuid, uuid) to service_role;

-- Signature access is mediated by the Next.js server route. Avatars remain public.
drop policy if exists "user uploads own signature" on storage.objects;
drop policy if exists "user reads own signature" on storage.objects;
drop policy if exists "trip owners read member signatures" on storage.objects;
drop policy if exists "user deletes own signature" on storage.objects;
drop policy if exists "user uploads own avatar" on storage.objects;
drop policy if exists "user deletes own avatar" on storage.objects;
drop policy if exists "public avatar read" on storage.objects;
create policy "public avatar read" on storage.objects for select to anon, authenticated
using (bucket_id = 'avatars');
