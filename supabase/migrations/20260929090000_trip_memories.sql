-- Phase C: one server-authoritative Memories scrapbook page per Trip.
-- Browser roles receive no table or RPC access; the Next.js server boundary
-- uses the service-role client and actor-aware SECURITY DEFINER RPCs.

create table public.trip_memories (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  template_key text not null default 'scrapbook_page',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trip_memories_template_key_check
    check (template_key in (
      'photobooth_strip', 'polaroid_board', 'scrapbook_page', 'travel_postcard'
    ))
);

create table public.trip_memory_photos (
  id uuid primary key,
  trip_id uuid not null references public.trip_memories(trip_id) on delete cascade,
  uploader_id uuid references public.profiles(id) on delete set null,
  slot_key text not null,
  storage_path text not null,
  mime_type text not null,
  file_size_bytes integer not null,
  focus_x double precision not null default 0.5,
  focus_y double precision not null default 0.5,
  scale double precision not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trip_memory_photos_slot_key_check
    check (slot_key in (
      'slot_01', 'slot_02', 'slot_03', 'slot_04', 'slot_05',
      'slot_06', 'slot_07', 'slot_08', 'slot_09', 'slot_10'
    )),
  constraint trip_memory_photos_mime_type_check
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint trip_memory_photos_file_size_check
    check (file_size_bytes between 1 and 4194304),
  constraint trip_memory_photos_focus_x_check
    check (focus_x >= 0 and focus_x <= 1 and focus_x = focus_x),
  constraint trip_memory_photos_focus_y_check
    check (focus_y >= 0 and focus_y <= 1 and focus_y = focus_y),
  constraint trip_memory_photos_scale_check
    check (scale >= 1 and scale <= 1.35 and scale = scale),
  constraint trip_memory_photos_storage_path_check
    check (
      storage_path = trip_id::text || '/' || id::text ||
        case mime_type
          when 'image/jpeg' then '.jpg'
          when 'image/png' then '.png'
          when 'image/webp' then '.webp'
        end
    ),
  constraint trip_memory_photos_storage_path_key unique (storage_path),
  constraint trip_memory_photos_trip_slot_key unique (trip_id, slot_key)
    deferrable initially immediate
);

create index trip_memory_photos_trip_id_idx
  on public.trip_memory_photos(trip_id);
create index trip_memory_photos_uploader_id_idx
  on public.trip_memory_photos(uploader_id);
create index trip_memory_photos_storage_path_idx
  on public.trip_memory_photos(storage_path);

create function private.set_trip_memory_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger trip_memories_updated_at
before update on public.trip_memories
for each row execute function private.set_trip_memory_updated_at();

create trigger trip_memory_photos_updated_at
before update on public.trip_memory_photos
for each row execute function private.set_trip_memory_updated_at();

alter table public.trip_memories enable row level security;
alter table public.trip_memory_photos enable row level security;

revoke all on table public.trip_memories, public.trip_memory_photos
  from public, anon, authenticated;
grant select, insert, update, delete on table public.trip_memories, public.trip_memory_photos
  to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'trip-memory-photos',
  'trip-memory-photos',
  false,
  4194304,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter publication supabase_realtime add table public.trip_memories;
alter publication supabase_realtime add table public.trip_memory_photos;

create function public.set_trip_memory_template(
  p_actor_id uuid,
  p_trip_id uuid,
  p_template_key text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.board_require_member(p_actor_id, p_trip_id, false);

  if not exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and user_id = p_actor_id
  ) then
    raise exception 'NOT_MEMBER';
  end if;

  if not exists (
    select 1 from public.trips
    where id = p_trip_id and owner_id = p_actor_id
  ) then
    raise exception 'TRIP_OWNER_REQUIRED';
  end if;

  if p_template_key is null
     or p_template_key not in (
       'photobooth_strip', 'polaroid_board', 'scrapbook_page', 'travel_postcard'
     ) then
    raise exception 'VALIDATION_ERROR';
  end if;

  insert into public.trip_memories(trip_id)
  values (p_trip_id)
  on conflict (trip_id) do nothing;

  update public.trip_memories
  set template_key = p_template_key
  where trip_id = p_trip_id;
end;
$$;

create function public.create_trip_memory_photo(
  p_actor_id uuid,
  p_trip_id uuid,
  p_photo_id uuid,
  p_slot_key text,
  p_storage_path text,
  p_mime_type text,
  p_file_size_bytes integer
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_path text;
  v_extension text;
begin
  perform private.board_require_member(p_actor_id, p_trip_id, false);

  if not exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and user_id = p_actor_id
  ) then
    raise exception 'NOT_MEMBER';
  end if;

  if p_photo_id is null
     or p_slot_key is null
     or p_slot_key not in (
       'slot_01', 'slot_02', 'slot_03', 'slot_04', 'slot_05',
       'slot_06', 'slot_07', 'slot_08', 'slot_09', 'slot_10'
     )
     or p_mime_type is null
     or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
     or p_file_size_bytes is null
     or p_file_size_bytes not between 1 and 4194304 then
    raise exception 'VALIDATION_ERROR';
  end if;

  insert into public.trip_memories(trip_id)
  values (p_trip_id)
  on conflict (trip_id) do nothing;

  if exists (
    select 1 from public.trip_memory_photos
    where trip_id = p_trip_id and slot_key = p_slot_key
  ) then
    raise exception 'MEMORY_SLOT_OCCUPIED';
  end if;

  v_extension := case p_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
  end;
  v_expected_path := p_trip_id::text || '/' || p_photo_id::text || '.' || v_extension;
  if p_storage_path is null or p_storage_path <> v_expected_path then
    raise exception 'VALIDATION_ERROR';
  end if;

  insert into public.trip_memory_photos(
    id, trip_id, uploader_id, slot_key, storage_path, mime_type, file_size_bytes
  ) values (
    p_photo_id, p_trip_id, p_actor_id, p_slot_key, p_storage_path,
    p_mime_type, p_file_size_bytes
  );

  update public.trip_memories
  set updated_at = clock_timestamp()
  where trip_id = p_trip_id;

  return p_photo_id;
end;
$$;

create function public.update_trip_memory_photo_placement(
  p_actor_id uuid,
  p_photo_id uuid,
  p_focus_x double precision,
  p_focus_y double precision,
  p_scale double precision
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip_id uuid;
  v_uploader_id uuid;
begin
  select trip_id, uploader_id
    into v_trip_id, v_uploader_id
  from public.trip_memory_photos
  where id = p_photo_id;
  if not found then
    raise exception 'PHOTO_NOT_FOUND';
  end if;

  perform private.board_require_member(p_actor_id, v_trip_id, false);

  select trip_id, uploader_id
    into v_trip_id, v_uploader_id
  from public.trip_memory_photos
  where id = p_photo_id
  for update;
  if not found then
    raise exception 'PHOTO_NOT_FOUND';
  end if;
  if v_uploader_id is distinct from p_actor_id then
    raise exception 'NOT_PHOTO_UPLOADER';
  end if;

  if p_focus_x is null or p_focus_y is null or p_scale is null
     or p_focus_x <> p_focus_x or p_focus_y <> p_focus_y or p_scale <> p_scale
     or p_focus_x < 0 or p_focus_x > 1
     or p_focus_y < 0 or p_focus_y > 1
     or p_scale < 1 or p_scale > 1.35 then
    raise exception 'VALIDATION_ERROR';
  end if;

  update public.trip_memory_photos
  set focus_x = p_focus_x,
      focus_y = p_focus_y,
      scale = p_scale
  where id = p_photo_id;

  update public.trip_memories
  set updated_at = clock_timestamp()
  where trip_id = v_trip_id;
end;
$$;

create function public.move_trip_memory_photo(
  p_actor_id uuid,
  p_photo_id uuid,
  p_target_slot_key text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_photo public.trip_memory_photos%rowtype;
  v_target public.trip_memory_photos%rowtype;
begin
  select * into v_photo
  from public.trip_memory_photos
  where id = p_photo_id;
  if not found then
    raise exception 'PHOTO_NOT_FOUND';
  end if;

  perform private.board_require_member(p_actor_id, v_photo.trip_id, false);

  select * into v_photo
  from public.trip_memory_photos
  where id = p_photo_id
  for update;
  if not found then
    raise exception 'PHOTO_NOT_FOUND';
  end if;
  if v_photo.uploader_id is distinct from p_actor_id then
    raise exception 'NOT_PHOTO_UPLOADER';
  end if;

  if p_target_slot_key is null
     or p_target_slot_key not in (
       'slot_01', 'slot_02', 'slot_03', 'slot_04', 'slot_05',
       'slot_06', 'slot_07', 'slot_08', 'slot_09', 'slot_10'
     ) then
    raise exception 'VALIDATION_ERROR';
  end if;
  if p_target_slot_key = v_photo.slot_key then
    return;
  end if;

  select * into v_target
  from public.trip_memory_photos
  where trip_id = v_photo.trip_id and slot_key = p_target_slot_key
  for update;

  if found then
    if v_target.uploader_id is distinct from p_actor_id then
      raise exception 'MEMORY_SLOT_OCCUPIED';
    end if;

    set constraints public.trip_memory_photos_trip_slot_key deferred;
    update public.trip_memory_photos
    set slot_key = v_photo.slot_key
    where id = v_target.id;
  end if;

  update public.trip_memory_photos
  set slot_key = p_target_slot_key
  where id = p_photo_id;

  update public.trip_memories
  set updated_at = clock_timestamp()
  where trip_id = v_photo.trip_id;
end;
$$;

create function public.delete_trip_memory_photo(
  p_actor_id uuid,
  p_photo_id uuid
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_photo public.trip_memory_photos%rowtype;
  v_owner_id uuid;
begin
  select * into v_photo
  from public.trip_memory_photos
  where id = p_photo_id;
  if not found then
    raise exception 'PHOTO_NOT_FOUND';
  end if;

  perform private.board_require_member(p_actor_id, v_photo.trip_id, false);

  select * into v_photo
  from public.trip_memory_photos
  where id = p_photo_id
  for update;
  if not found then
    raise exception 'PHOTO_NOT_FOUND';
  end if;

  select owner_id into v_owner_id
  from public.trips
  where id = v_photo.trip_id;
  if v_photo.uploader_id is distinct from p_actor_id
     and v_owner_id is distinct from p_actor_id then
    raise exception 'NOT_PHOTO_UPLOADER';
  end if;

  delete from public.trip_memory_photos
  where id = p_photo_id;

  update public.trip_memories
  set updated_at = clock_timestamp()
  where trip_id = v_photo.trip_id;

  return v_photo.storage_path;
end;
$$;

revoke all on function public.set_trip_memory_template(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.create_trip_memory_photo(uuid, uuid, uuid, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.update_trip_memory_photo_placement(uuid, uuid, double precision, double precision, double precision)
  from public, anon, authenticated;
revoke all on function public.move_trip_memory_photo(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.delete_trip_memory_photo(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.set_trip_memory_template(uuid, uuid, text)
  to service_role;
grant execute on function public.create_trip_memory_photo(uuid, uuid, uuid, text, text, text, integer)
  to service_role;
grant execute on function public.update_trip_memory_photo_placement(uuid, uuid, double precision, double precision, double precision)
  to service_role;
grant execute on function public.move_trip_memory_photo(uuid, uuid, text)
  to service_role;
grant execute on function public.delete_trip_memory_photo(uuid, uuid)
  to service_role;
