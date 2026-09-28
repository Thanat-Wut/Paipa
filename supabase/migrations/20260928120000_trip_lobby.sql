-- Phase B: one server-authoritative Lobby per Trip.
-- The Lobby tables are intentionally server-bound. Browser clients use the
-- Next.js server boundary for reads and mutations.

create table public.trip_lobbies (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  background_kind text not null default 'preset',
  preset_key text default 'cozy',
  custom_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trip_lobbies_background_kind_check
    check (background_kind in ('preset', 'custom')),
  constraint trip_lobbies_background_consistency_check
    check (
      (background_kind = 'preset'
       and preset_key in ('cozy', 'cabin', 'beach', 'chill')
       and custom_storage_path is null)
      or
      (background_kind = 'custom'
       and preset_key is null
       and custom_storage_path is not null)
    ),
  constraint trip_lobbies_custom_path_check
    check (
      custom_storage_path is null
      or lower(custom_storage_path) ~ (
        '^' || trip_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$'
      )
    )
);

create table public.trip_lobby_positions (
  trip_id uuid not null,
  user_id uuid not null,
  position_x double precision not null check (position_x >= 0 and position_x <= 1),
  position_y double precision not null check (position_y >= 0 and position_y <= 1),
  updated_at timestamptz not null default now(),
  primary key (trip_id, user_id),
  constraint trip_lobby_positions_member_fk
    foreign key (trip_id, user_id)
    references public.trip_members(trip_id, user_id)
    on delete cascade
);

create index trip_lobbies_custom_storage_path_idx
  on public.trip_lobbies(custom_storage_path)
  where custom_storage_path is not null;

alter table public.trip_lobbies enable row level security;
alter table public.trip_lobby_positions enable row level security;

revoke all on table public.trip_lobbies, public.trip_lobby_positions
  from public, anon, authenticated;
grant select on table public.trip_lobbies, public.trip_lobby_positions to service_role;

create function public.update_trip_lobby_position(
  p_actor_id uuid,
  p_trip_id uuid,
  p_position_x double precision,
  p_position_y double precision
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.board_require_member(p_actor_id, p_trip_id, false);

  if p_position_x is null or p_position_y is null
     or p_position_x < 0 or p_position_x > 1
     or p_position_y < 0 or p_position_y > 1 then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- The helper locks the Trip row. Require the actor to be a real member as
  -- well as an owner/member recognized by the broader Trip access helper so
  -- the composite FK remains the final database invariant.
  if not exists (
    select 1
    from public.trip_members
    where trip_id = p_trip_id and user_id = p_actor_id
  ) then
    raise exception 'NOT_MEMBER';
  end if;

  insert into public.trip_lobbies(trip_id)
  values (p_trip_id)
  on conflict (trip_id) do nothing;

  insert into public.trip_lobby_positions(trip_id, user_id, position_x, position_y)
  values (p_trip_id, p_actor_id, p_position_x, p_position_y)
  on conflict (trip_id, user_id) do update
    set position_x = excluded.position_x,
        position_y = excluded.position_y,
        updated_at = now();
end;
$$;

create function public.set_trip_lobby_preset(
  p_actor_id uuid,
  p_trip_id uuid,
  p_preset_key text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_custom_path text;
begin
  perform private.board_require_member(p_actor_id, p_trip_id, false);

  if not exists (
    select 1 from public.trips
    where id = p_trip_id and owner_id = p_actor_id
  ) then
    raise exception 'TRIP_OWNER_REQUIRED';
  end if;

  if p_preset_key is null
     or p_preset_key not in ('cozy', 'cabin', 'beach', 'chill') then
    raise exception 'VALIDATION_ERROR';
  end if;

  insert into public.trip_lobbies(trip_id)
  values (p_trip_id)
  on conflict (trip_id) do nothing;

  select custom_storage_path
    into v_previous_custom_path
  from public.trip_lobbies
  where trip_id = p_trip_id
  for update;

  update public.trip_lobbies
  set background_kind = 'preset',
      preset_key = p_preset_key,
      custom_storage_path = null,
      updated_at = now()
  where trip_id = p_trip_id;

  return v_previous_custom_path;
end;
$$;

create function public.set_trip_lobby_custom_background(
  p_actor_id uuid,
  p_trip_id uuid,
  p_custom_storage_path text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_custom_path text;
  v_path text;
begin
  perform private.board_require_member(p_actor_id, p_trip_id, false);

  if not exists (
    select 1 from public.trips
    where id = p_trip_id and owner_id = p_actor_id
  ) then
    raise exception 'TRIP_OWNER_REQUIRED';
  end if;

  v_path := lower(btrim(coalesce(p_custom_storage_path, '')));
  if p_custom_storage_path is null
     or p_custom_storage_path <> btrim(p_custom_storage_path)
     or v_path !~ (
       '^' || p_trip_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$'
     ) then
    raise exception 'VALIDATION_ERROR';
  end if;

  insert into public.trip_lobbies(trip_id)
  values (p_trip_id)
  on conflict (trip_id) do nothing;

  select custom_storage_path
    into v_previous_custom_path
  from public.trip_lobbies
  where trip_id = p_trip_id
  for update;

  update public.trip_lobbies
  set background_kind = 'custom',
      preset_key = null,
      custom_storage_path = v_path,
      updated_at = now()
  where trip_id = p_trip_id;

  return v_previous_custom_path;
end;
$$;

revoke execute on function public.update_trip_lobby_position(uuid, uuid, double precision, double precision)
  from public, anon, authenticated;
revoke execute on function public.set_trip_lobby_preset(uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.set_trip_lobby_custom_background(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.update_trip_lobby_position(uuid, uuid, double precision, double precision)
  to service_role;
grant execute on function public.set_trip_lobby_preset(uuid, uuid, text)
  to service_role;
grant execute on function public.set_trip_lobby_custom_background(uuid, uuid, text)
  to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'trip-room-backgrounds',
  'trip-room-backgrounds',
  false,
  4194304,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter publication supabase_realtime add table public.trip_lobbies;
alter publication supabase_realtime add table public.trip_lobby_positions;
