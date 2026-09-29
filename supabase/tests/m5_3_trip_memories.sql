-- Phase C: one server-authoritative Memories page per Trip.
-- Every fixture is disposable and rolled back at the end of this file.
begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_other_member uuid := gen_random_uuid();
  v_former uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_other_owner uuid := gen_random_uuid();
  v_trip uuid := gen_random_uuid();
  v_other_trip uuid := gen_random_uuid();
  v_archived_trip uuid := gen_random_uuid();
  v_delete_trip uuid := gen_random_uuid();
  v_legacy_trip uuid := gen_random_uuid();
  v_member_photo uuid := gen_random_uuid();
  v_other_photo uuid := gen_random_uuid();
  v_owner_photo uuid := gen_random_uuid();
  v_owner_photo_two uuid := gen_random_uuid();
  v_former_photo uuid := gen_random_uuid();
  v_moderated_photo uuid := gen_random_uuid();
  v_archived_photo uuid := gen_random_uuid();
  v_other_trip_photo uuid := gen_random_uuid();
  v_delete_trip_photo uuid := gen_random_uuid();
  v_photo_id uuid := gen_random_uuid();
  v_path text;
  v_returned_path text;
  v_slot text;
  v_trip_id uuid;
  v_uploader_id uuid;
  v_owner_id uuid;
  v_rpc regprocedure;
  v_table text;
begin
  if to_regclass('public.trip_memories') is null
     or to_regclass('public.trip_memory_photos') is null then
    raise exception 'Trip Memories tables are missing';
  end if;

  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'trip_memories'
      and column_name in ('trip_id', 'template_key', 'created_at', 'updated_at')) <> 4 then
    raise exception 'Trip Memories page columns are incomplete';
  end if;
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'trip_memory_photos'
      and column_name in (
        'id', 'trip_id', 'uploader_id', 'slot_key', 'storage_path', 'mime_type',
        'file_size_bytes', 'focus_x', 'focus_y', 'scale', 'created_at', 'updated_at'
      )) <> 12 then
    raise exception 'Trip Memories photo columns are incomplete';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.trip_memories'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.trip_memory_photos'::regclass) then
    raise exception 'Trip Memories tables must have RLS enabled';
  end if;
  if has_table_privilege('anon', 'public.trip_memories', 'select')
     or has_table_privilege('authenticated', 'public.trip_memories', 'select')
     or has_table_privilege('anon', 'public.trip_memory_photos', 'select')
     or has_table_privilege('authenticated', 'public.trip_memory_photos', 'select') then
    raise exception 'Trip Memories tables are exposed to browser roles';
  end if;
  if not has_table_privilege('service_role', 'public.trip_memories', 'select')
     or not has_table_privilege('service_role', 'public.trip_memory_photos', 'select') then
    raise exception 'Trip Memories service-role table grants are missing';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.trip_memories'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) like 'PRIMARY KEY (trip_id)%'
  ) then
    raise exception 'Trip Memories page must use trip_id as its primary key';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.trip_memory_photos'::regclass
      and confrelid = 'public.trip_memories'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like '%ON DELETE CASCADE%'
  ) then
    raise exception 'Trip Memory photos must cascade with their page';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.trip_memory_photos'::regclass
      and confrelid = 'public.profiles'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like '%ON DELETE SET NULL%'
  ) then
    raise exception 'Trip Memory uploader FK must set null on profile deletion';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.trip_memory_photos'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%(storage_path)%'
  ) then
    raise exception 'Trip Memory storage paths must be unique';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.trip_memory_photos'::regclass
      and contype = 'u'
      and condeferrable
      and pg_get_constraintdef(oid) like '%(trip_id, slot_key)%'
  ) then
    raise exception 'Trip Memory slot uniqueness must be deferrable';
  end if;

  foreach v_table in array array['trip_memories', 'trip_memory_photos'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      raise exception 'Trip Memories table % is missing from supabase_realtime', v_table;
    end if;
  end loop;

  foreach v_table in array array[
    'trip_memory_photos_trip_id_idx',
    'trip_memory_photos_uploader_id_idx',
    'trip_memory_photos_storage_path_idx'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'Trip Memories index % is missing', v_table;
    end if;
  end loop;

  if not exists (
    select 1 from storage.buckets
    where id = 'trip-memory-photos'
      and name = 'trip-memory-photos'
      and public = false
      and file_size_limit = 4194304
      and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
  ) then
    raise exception 'Trip Memories Storage bucket metadata is incorrect';
  end if;

  foreach v_rpc in array array[
    'public.set_trip_memory_template(uuid,uuid,text)'::regprocedure,
    'public.create_trip_memory_photo(uuid,uuid,uuid,text,text,text,integer)'::regprocedure,
    'public.update_trip_memory_photo_placement(uuid,uuid,double precision,double precision,double precision)'::regprocedure,
    'public.move_trip_memory_photo(uuid,uuid,text)'::regprocedure,
    'public.delete_trip_memory_photo(uuid,uuid)'::regprocedure
  ] loop
    if not (select prosecdef from pg_proc where oid = v_rpc)
       or not (select proconfig @> array['search_path=""']::text[] from pg_proc where oid = v_rpc) then
      raise exception 'Trip Memories RPC % must be SECURITY DEFINER with an empty search_path', v_rpc;
    end if;
    if has_function_privilege('public', v_rpc::text, 'execute')
       or has_function_privilege('anon', v_rpc::text, 'execute')
       or has_function_privilege('authenticated', v_rpc::text, 'execute')
       or not has_function_privilege('service_role', v_rpc::text, 'execute') then
      raise exception 'Trip Memories RPC % has incorrect EXECUTE privileges', v_rpc;
    end if;
  end loop;

  insert into public.profiles(id, display_name) values
    (v_owner, 'Memories Owner'),
    (v_member, 'Memories Member'),
    (v_other_member, 'Memories Other Member'),
    (v_former, 'Memories Former'),
    (v_outsider, 'Memories Outsider'),
    (v_other_owner, 'Memories Other Owner');

  insert into public.trips(id, owner_id, name, start_date, end_date, status) values
    (v_trip, v_owner, 'Memories trip', '2026-10-01', '2026-10-02', 'planning'),
    (v_other_trip, v_other_owner, 'Other Memories trip', '2026-10-03', '2026-10-04', 'planning'),
    (v_archived_trip, v_owner, 'Archived Memories trip', '2026-10-05', '2026-10-06', 'archived'),
    (v_delete_trip, v_owner, 'Delete Memories trip', '2026-10-07', '2026-10-08', 'planning'),
    (v_legacy_trip, v_owner, 'Legacy Memories trip', '2026-10-09', '2026-10-10', 'planning');

  insert into public.trip_members(trip_id, user_id, display_name, role, attendance, joined_at) values
    (v_trip, v_owner, 'Memories Owner', 'owner', 'maybe', '2026-09-28T09:00:00Z'),
    (v_trip, v_member, 'Memories Member', 'member', 'maybe', '2026-09-28T09:01:00Z'),
    (v_trip, v_other_member, 'Memories Other Member', 'member', 'maybe', '2026-09-28T09:02:00Z'),
    (v_trip, v_former, 'Memories Former', 'member', 'maybe', '2026-09-28T09:03:00Z'),
    (v_other_trip, v_other_owner, 'Memories Other Owner', 'owner', 'maybe', '2026-09-28T09:00:00Z'),
    (v_archived_trip, v_owner, 'Memories Owner', 'owner', 'maybe', '2026-09-28T09:00:00Z'),
    (v_delete_trip, v_owner, 'Memories Owner', 'owner', 'maybe', '2026-09-28T09:00:00Z'),
    (v_legacy_trip, v_owner, 'Memories Owner', 'owner', 'maybe', '2026-09-28T09:00:00Z');

  if exists (select 1 from public.trip_memories where trip_id = v_legacy_trip) then
    raise exception 'A legacy Trip must not receive a page before its first mutation';
  end if;

  v_path := v_trip::text || '/' || v_member_photo::text || '.jpg';
  if public.create_trip_memory_photo(
    v_member, v_trip, v_member_photo, 'slot_01', v_path, 'image/jpeg', 1024
  ) <> v_member_photo then
    raise exception 'member photo creation returned the wrong ID';
  end if;
  if not exists (
    select 1 from public.trip_memories
    where trip_id = v_trip and template_key = 'scrapbook_page'
  ) then
    raise exception 'first photo mutation must lazily create the default page';
  end if;

  v_path := v_trip::text || '/' || v_other_photo::text || '.png';
  perform public.create_trip_memory_photo(
    v_other_member, v_trip, v_other_photo, 'slot_02', v_path, 'image/png', 2048
  );
  v_path := v_trip::text || '/' || v_owner_photo::text || '.webp';
  perform public.create_trip_memory_photo(
    v_owner, v_trip, v_owner_photo, 'slot_03', v_path, 'image/webp', 4096
  );
  v_path := v_trip::text || '/' || v_owner_photo_two::text || '.jpg';
  perform public.create_trip_memory_photo(
    v_owner, v_trip, v_owner_photo_two, 'slot_05', v_path, 'image/jpeg', 1024
  );
  v_path := v_trip::text || '/' || v_former_photo::text || '.jpg';
  perform public.create_trip_memory_photo(
    v_former, v_trip, v_former_photo, 'slot_06', v_path, 'image/jpeg', 1024
  );
  v_path := v_trip::text || '/' || v_moderated_photo::text || '.png';
  perform public.create_trip_memory_photo(
    v_member, v_trip, v_moderated_photo, 'slot_07', v_path, 'image/png', 1024
  );
  v_path := v_other_trip::text || '/' || v_other_trip_photo::text || '.jpg';
  perform public.create_trip_memory_photo(
    v_other_owner, v_other_trip, v_other_trip_photo, 'slot_01', v_path, 'image/jpeg', 1024
  );
  v_path := v_delete_trip::text || '/' || v_delete_trip_photo::text || '.jpg';
  perform public.create_trip_memory_photo(
    v_owner, v_delete_trip, v_delete_trip_photo, 'slot_01', v_path, 'image/jpeg', 1024
  );

  perform public.set_trip_memory_template(v_owner, v_trip, 'travel_postcard');
  if not exists (
    select 1 from public.trip_memories
    where trip_id = v_trip and template_key = 'travel_postcard'
  ) then
    raise exception 'owner template change did not persist';
  end if;

  begin
    perform public.set_trip_memory_template(v_member, v_trip, 'polaroid_board');
    raise exception 'non-owner template mutation should be denied';
  exception when others then
    if sqlerrm not like '%TRIP_OWNER_REQUIRED%' then raise; end if;
  end;
  begin
    perform public.set_trip_memory_template(v_owner, v_trip, 'freeform');
    raise exception 'unknown template should be denied';
  exception when others then
    if sqlerrm not like '%VALIDATION_ERROR%' then raise; end if;
  end;

  begin
    perform public.create_trip_memory_photo(
      v_member, v_trip, gen_random_uuid(), 'slot_01',
      v_trip::text || '/44444444-4444-4444-8444-444444444444.jpg', 'image/jpeg', 1024
    );
    raise exception 'occupied slot should be denied';
  exception when others then
    if sqlerrm not like '%MEMORY_SLOT_OCCUPIED%' then raise; end if;
  end;
  begin
    perform public.create_trip_memory_photo(
      v_member, v_trip, gen_random_uuid(), 'slot_08',
      v_trip::text || '/44444444-4444-4444-8444-444444444444.png', 'image/jpeg', 1024
    );
    raise exception 'MIME/path mismatch should be denied';
  exception when others then
    if sqlerrm not like '%VALIDATION_ERROR%' then raise; end if;
  end;
  begin
    perform public.create_trip_memory_photo(
      v_member, v_trip, gen_random_uuid(), 'slot_08',
      v_trip::text || '/44444444-4444-4444-8444-444444444444.jpg', 'image/jpeg', 0
    );
    raise exception 'zero-byte photo should be denied';
  exception when others then
    if sqlerrm not like '%VALIDATION_ERROR%' then raise; end if;
  end;
  begin
    perform public.create_trip_memory_photo(
      v_member, v_trip, gen_random_uuid(), 'slot_08',
      v_other_trip::text || '/44444444-4444-4444-8444-444444444444.jpg', 'image/jpeg', 1024
    );
    raise exception 'cross-Trip Storage path should be denied';
  exception when others then
    if sqlerrm not like '%VALIDATION_ERROR%' then raise; end if;
  end;
  v_photo_id := gen_random_uuid();
  v_path := v_legacy_trip::text || '/' || v_photo_id::text || '.jpg';
  begin
    perform public.create_trip_memory_photo(
      v_owner, v_legacy_trip, v_photo_id, 'slot_01', v_path, null, 1024
    );
    raise exception 'NULL MIME type should be denied';
  exception when others then
    if sqlerrm not like '%VALIDATION_ERROR%' then raise; end if;
  end;
  if exists (select 1 from public.trip_memories where trip_id = v_legacy_trip)
     or exists (select 1 from public.trip_memory_photos where trip_id = v_legacy_trip)
     or exists (select 1 from public.trip_memory_photos where id = v_photo_id) then
    raise exception 'NULL MIME validation left unexpected page/photo residue';
  end if;

  perform public.update_trip_memory_photo_placement(v_member, v_member_photo, 0.25, 0.75, 1.35);
  begin
    perform public.update_trip_memory_photo_placement(v_owner, v_member_photo, 0.4, 0.4, 1.1);
    raise exception 'another member must not mutate a photo';
  exception when others then
    if sqlerrm not like '%NOT_PHOTO_UPLOADER%' then raise; end if;
  end;
  begin
    perform public.update_trip_memory_photo_placement(v_member, v_member_photo, -0.1, 0.5, 1.1);
    raise exception 'invalid focus placement should be denied';
  exception when others then
    if sqlerrm not like '%VALIDATION_ERROR%' then raise; end if;
  end;
  begin
    perform public.update_trip_memory_photo_placement(v_member, v_member_photo, 0.5, 0.5, 1.36);
    raise exception 'invalid scale placement should be denied';
  exception when others then
    if sqlerrm not like '%VALIDATION_ERROR%' then raise; end if;
  end;

  -- Two actors target the same slot. The first writer wins and the stale
  -- second writer receives a conflict without changing either assignment.
  perform public.move_trip_memory_photo(v_owner, v_owner_photo, 'slot_04');
  begin
    perform public.move_trip_memory_photo(v_member, v_member_photo, 'slot_04');
    raise exception 'stale occupied-slot writer should be denied';
  exception when others then
    if sqlerrm not like '%MEMORY_SLOT_OCCUPIED%' then raise; end if;
  end;
  if not exists (
    select 1 from public.trip_memory_photos
    where id = v_owner_photo and slot_key = 'slot_04'
  ) or not exists (
    select 1 from public.trip_memory_photos
    where id = v_member_photo and slot_key = 'slot_01'
  ) then
    raise exception 'occupied-slot conflict changed an existing assignment';
  end if;

  -- Same-owner swap is atomic and preserves the one-photo-per-slot invariant.
  perform public.move_trip_memory_photo(v_owner, v_owner_photo, 'slot_05');
  if not exists (
    select 1 from public.trip_memory_photos
    where id = v_owner_photo and slot_key = 'slot_05'
  ) or not exists (
    select 1 from public.trip_memory_photos
    where id = v_owner_photo_two and slot_key = 'slot_04'
  ) then
    raise exception 'same-owner move/swap did not preserve both assignments';
  end if;
  begin
    perform public.move_trip_memory_photo(v_member, v_member_photo, 'slot_05');
    raise exception 'another member must not overwrite the owner slot';
  exception when others then
    if sqlerrm not like '%MEMORY_SLOT_OCCUPIED%' then raise; end if;
  end;
  if not exists (
    select 1 from public.trip_memory_photos
    where id = v_member_photo and slot_key = 'slot_01'
  ) then
    raise exception 'failed move changed the original assignment';
  end if;

  -- A deleted profile leaves its photo in place but removes ownership. A
  -- remaining member must not swap into that former-member slot.
  delete from public.profiles where id = v_other_member;
  if not exists (
    select 1 from public.trip_memory_photos
    where id = v_other_photo and slot_key = 'slot_02' and uploader_id is null
  ) then
    raise exception 'former-member photo was not preserved with a null uploader';
  end if;
  begin
    perform public.move_trip_memory_photo(v_member, v_member_photo, 'slot_02');
    raise exception 'member must not overwrite a former-member photo';
  exception when others then
    if sqlerrm not like '%MEMORY_SLOT_OCCUPIED%' then raise; end if;
  end;
  if not exists (
    select 1 from public.trip_memory_photos
    where id = v_member_photo and slot_key = 'slot_01'
  ) or not exists (
    select 1 from public.trip_memory_photos
    where id = v_other_photo and slot_key = 'slot_02' and uploader_id is null
  ) then
    raise exception 'former-member target rejection changed an existing assignment';
  end if;

  begin
    perform public.update_trip_memory_photo_placement(v_member, v_other_trip_photo, 0.2, 0.2, 1.1);
    raise exception 'cross-Trip photo mutation should be denied';
  exception when others then
    if sqlerrm not like '%NOT_MEMBER%' then raise; end if;
  end;

  select public.delete_trip_memory_photo(v_owner, v_moderated_photo) into v_returned_path;
  if v_returned_path <> v_trip::text || '/' || v_moderated_photo::text || '.png'
     or exists (select 1 from public.trip_memory_photos where id = v_moderated_photo) then
    raise exception 'owner moderation delete did not return/delete the photo';
  end if;

  delete from public.trip_members where trip_id = v_trip and user_id = v_former;
  begin
    perform public.update_trip_memory_photo_placement(v_former, v_former_photo, 0.2, 0.2, 1.1);
    raise exception 'removed member placement mutation should be denied';
  exception when others then
    if sqlerrm not like '%NOT_MEMBER%' then raise; end if;
  end;
  delete from public.profiles where id = v_former;
  if not exists (
    select 1 from public.trip_memory_photos
    where id = v_former_photo and uploader_id is null
  ) then
    raise exception 'profile deletion must preserve the photo with a null uploader';
  end if;

  insert into public.trip_memories(trip_id) values (v_archived_trip);
  insert into public.trip_memory_photos(
    id, trip_id, uploader_id, slot_key, storage_path, mime_type, file_size_bytes
  ) values (
    v_archived_photo, v_archived_trip, v_owner, 'slot_01',
    v_archived_trip::text || '/' || v_archived_photo::text || '.jpg',
    'image/jpeg', 1024
  );
  begin
    perform public.update_trip_memory_photo_placement(v_owner, v_archived_photo, 0.2, 0.2, 1.1);
    raise exception 'archived placement mutation should be denied';
  exception when others then
    if sqlerrm not like '%TRIP_ARCHIVED%' then raise; end if;
  end;
  begin
    perform public.delete_trip_memory_photo(v_owner, v_archived_photo);
    raise exception 'archived delete should be denied';
  exception when others then
    if sqlerrm not like '%TRIP_ARCHIVED%' then raise; end if;
  end;
  begin
    perform public.set_trip_memory_template(v_owner, v_archived_trip, 'polaroid_board');
    raise exception 'archived template mutation should be denied';
  exception when others then
    if sqlerrm not like '%TRIP_ARCHIVED%' then raise; end if;
  end;

  begin
    perform public.create_trip_memory_photo(
      v_owner, v_archived_trip, gen_random_uuid(), 'slot_02',
      v_archived_trip::text || '/55555555-5555-4555-8555-555555555555.jpg', 'image/jpeg', 1024
    );
    raise exception 'archived upload should be denied';
  exception when others then
    if sqlerrm not like '%TRIP_ARCHIVED%' then raise; end if;
  end;

  delete from public.trips where id = v_delete_trip;
  if exists (select 1 from public.trip_memories where trip_id = v_delete_trip)
     or exists (select 1 from public.trip_memory_photos where trip_id = v_delete_trip) then
    raise exception 'Trip deletion did not cascade Memories rows';
  end if;
end;
$$;

rollback;
