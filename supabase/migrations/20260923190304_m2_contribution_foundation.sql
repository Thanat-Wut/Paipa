-- M2.1: retain trip-scoped financial accounts independently from roster membership.
-- Existing trip/profile/member identifiers and rows are preserved.

alter table public.trips
  add column currency text not null default 'THB';

alter table public.trips
  add constraint trips_currency_thb_check check (currency = 'THB');

create table public.contributions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  contributor_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contributions_trip_contributor_key unique (trip_id, contributor_id)
);

create index contributions_contributor_id_idx
  on public.contributions (contributor_id);

alter table public.contributions enable row level security;
revoke all on table public.contributions from public, anon, authenticated;
grant select, insert, update, delete on table public.contributions to service_role;

insert into public.contributions (trip_id, contributor_id)
select trip_id, user_id
from public.trip_members
on conflict (trip_id, contributor_id) do nothing;

create or replace function public.create_trip(
  p_actor_id uuid,
  p_name text,
  p_description text,
  p_destination text,
  p_start_date date,
  p_end_date date,
  p_budget_per_person numeric,
  p_max_members integer
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_trip_id uuid;
  v_name text;
  v_description text;
  v_destination text;
  v_display_name text;
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

  insert into public.contributions(trip_id, contributor_id)
  values (v_trip_id, p_actor_id)
  on conflict (trip_id, contributor_id) do nothing;

  return v_trip_id;
end;
$$;

create or replace function public.join_trip(
  p_actor_id uuid,
  p_code text,
  p_display_name text,
  p_avatar_type text,
  p_avatar_url text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_invite public.trip_invites%rowtype;
  v_trip public.trips%rowtype;
  v_count bigint;
begin
  if not exists(select 1 from public.profiles where id = p_actor_id) then
    raise exception 'Profile not found';
  end if;
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
    insert into public.contributions(trip_id, contributor_id)
    values (v_trip.id, p_actor_id)
    on conflict (trip_id, contributor_id) do nothing;
    return v_trip.id;
  end if;

  select count(*) into v_count from public.trip_members where trip_id = v_trip.id;
  if v_count >= v_trip.max_members then raise exception 'Trip is full'; end if;

  insert into public.trip_members(trip_id, user_id, display_name, avatar_type, avatar_url, attendance)
  values (v_trip.id, p_actor_id, btrim(p_display_name), p_avatar_type,
    nullif(btrim(coalesce(p_avatar_url, '')), ''), 'maybe');

  insert into public.contributions(trip_id, contributor_id)
  values (v_trip.id, p_actor_id)
  on conflict (trip_id, contributor_id) do nothing;

  update public.trip_invites set usage_count = usage_count + 1 where id = v_invite.id;
  return v_trip.id;
end;
$$;
