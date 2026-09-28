-- Trip Lobby schema and authorization acceptance checks. Every fixture is rolled back.
begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_former uuid := gen_random_uuid();
  v_other_owner uuid := gen_random_uuid();
  v_trip uuid := gen_random_uuid();
  v_other_trip uuid := gen_random_uuid();
  v_archived_trip uuid := gen_random_uuid();
  v_delete_trip uuid := gen_random_uuid();
  v_path text;
  v_x double precision;
  v_y double precision;
  v_rpc regprocedure;
  v_table text;
  v_unique_count integer;
begin
  if to_regclass('public.trip_lobbies') is null or to_regclass('public.trip_lobby_positions') is null then
    raise exception 'Trip Lobby tables are missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.trip_lobbies'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.trip_lobby_positions'::regclass) then
    raise exception 'Trip Lobby RLS must be enabled';
  end if;
  if has_table_privilege('anon', 'public.trip_lobbies', 'select')
     or has_table_privilege('authenticated', 'public.trip_lobbies', 'select')
     or has_table_privilege('anon', 'public.trip_lobby_positions', 'select')
     or has_table_privilege('authenticated', 'public.trip_lobby_positions', 'select') then
    raise exception 'Trip Lobby tables are exposed to browser roles';
  end if;

  select count(*) into v_unique_count
  from pg_constraint
  where conrelid = 'public.trip_members'::regclass
    and contype in ('u', 'p')
    and pg_get_constraintdef(oid) like 'UNIQUE (trip_id, user_id)%';
  if v_unique_count <> 1 then
    raise exception 'Trip Lobby must reuse exactly one existing trip_members composite unique key, found %', v_unique_count;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.trip_lobby_positions'::regclass
      and confrelid = 'public.trip_members'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like '%(trip_id, user_id)%'
      and pg_get_constraintdef(oid) like '%ON DELETE CASCADE%'
  ) then
    raise exception 'Lobby position composite member FK is missing or not cascading';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.trip_lobbies'::regclass
      and pg_get_constraintdef(oid) like '%background_kind%'
      and pg_get_constraintdef(oid) like '%preset%'
      and pg_get_constraintdef(oid) like '%custom%'
  ) then
    raise exception 'Lobby background consistency constraint is missing';
  end if;
  if not exists (
    select 1 from pg_class where relname = 'trip_lobbies_custom_storage_path_idx'
  ) then
    raise exception 'Lobby custom path lookup index is missing';
  end if;

  foreach v_rpc in array array[
    'public.update_trip_lobby_position(uuid,uuid,double precision,double precision)'::regprocedure,
    'public.set_trip_lobby_preset(uuid,uuid,text)'::regprocedure,
    'public.set_trip_lobby_custom_background(uuid,uuid,text)'::regprocedure
  ] loop
    if not (select prosecdef from pg_proc where oid = v_rpc)
       or not (select proconfig @> array['search_path=""']::text[] from pg_proc where oid = v_rpc) then
      raise exception 'Lobby RPC % must be SECURITY DEFINER with an empty search_path', v_rpc;
    end if;
    if has_function_privilege('anon', v_rpc::text, 'execute')
       or has_function_privilege('authenticated', v_rpc::text, 'execute')
       or not has_function_privilege('service_role', v_rpc::text, 'execute') then
      raise exception 'Lobby RPC % has incorrect EXECUTE privileges', v_rpc;
    end if;
  end loop;

  if not exists (
    select 1 from storage.buckets
    where id = 'trip-room-backgrounds'
      and public = false
      and file_size_limit = 4194304
      and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
  ) then
    raise exception 'Lobby Storage bucket metadata is incorrect';
  end if;

  foreach v_table in array array['trip_lobbies', 'trip_lobby_positions'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      raise exception 'Lobby table % is missing from supabase_realtime', v_table;
    end if;
  end loop;

  insert into public.profiles(id, display_name) values
    (v_owner, 'Lobby Owner'), (v_member, 'Lobby Member'), (v_outsider, 'Lobby Outsider'),
    (v_former, 'Lobby Former'), (v_other_owner, 'Lobby Other Owner');
  insert into public.trips(id, owner_id, name, start_date, end_date, status) values
    (v_trip, v_owner, 'Lobby trip', '2026-10-01', '2026-10-02', 'planning'),
    (v_other_trip, v_other_owner, 'Other Lobby trip', '2026-10-03', '2026-10-04', 'planning'),
    (v_archived_trip, v_owner, 'Archived Lobby trip', '2026-10-05', '2026-10-06', 'archived'),
    (v_delete_trip, v_owner, 'Delete Lobby trip', '2026-10-07', '2026-10-08', 'planning');
  insert into public.trip_members(trip_id, user_id, display_name, role, attendance, joined_at) values
    (v_trip, v_owner, 'Lobby Owner', 'owner', 'maybe', '2026-09-28T09:00:00Z'),
    (v_trip, v_member, 'Lobby Member', 'member', 'maybe', '2026-09-28T09:01:00Z'),
    (v_trip, v_former, 'Lobby Former', 'member', 'maybe', '2026-09-28T09:02:00Z'),
    (v_other_trip, v_other_owner, 'Lobby Other Owner', 'owner', 'maybe', '2026-09-28T09:00:00Z'),
    (v_archived_trip, v_owner, 'Lobby Owner', 'owner', 'maybe', '2026-09-28T09:00:00Z'),
    (v_delete_trip, v_owner, 'Lobby Owner', 'owner', 'maybe', '2026-09-28T09:00:00Z');

  perform public.update_trip_lobby_position(v_member, v_trip, 0.61, 0.29);
  select position_x, position_y into v_x, v_y
  from public.trip_lobby_positions where trip_id = v_trip and user_id = v_member;
  if abs(v_x - 0.61) > 0.0000001 or abs(v_y - 0.29) > 0.0000001 then
    raise exception 'member Lobby position did not persist';
  end if;

  select public.set_trip_lobby_preset(v_owner, v_trip, 'cabin') into v_path;
  if v_path is not null then raise exception 'preset mutation returned an unexpected old custom path'; end if;
  if not exists (select 1 from public.trip_lobbies where trip_id = v_trip and background_kind = 'preset' and preset_key = 'cabin' and custom_storage_path is null) then
    raise exception 'preset Lobby state is invalid';
  end if;

  v_path := v_trip::text || '/698cf99c-4eb8-4543-861b-e5c267e2da38.png';
  select public.set_trip_lobby_custom_background(v_owner, v_trip, v_path) into v_path;
  if not exists (select 1 from public.trip_lobbies where trip_id = v_trip and background_kind = 'custom' and preset_key is null) then
    raise exception 'custom Lobby state is invalid';
  end if;

  begin
    perform public.update_trip_lobby_position(v_outsider, v_trip, 0.1, 0.1);
    raise exception 'outsider position mutation should be denied';
  exception when others then
    if sqlerrm not like '%NOT_MEMBER%' then raise; end if;
  end;

  begin
    perform public.set_trip_lobby_preset(v_member, v_trip, 'beach');
    raise exception 'member background mutation should be denied';
  exception when others then
    if sqlerrm not like '%TRIP_OWNER_REQUIRED%' then raise; end if;
  end;

  begin
    perform public.set_trip_lobby_preset(v_owner, v_trip, 'unknown');
    raise exception 'unknown preset should be denied';
  exception when others then
    if sqlerrm not like '%VALIDATION_ERROR%' then raise; end if;
  end;

  begin
    perform public.update_trip_lobby_position(v_member, v_other_trip, 0.2, 0.2);
    raise exception 'cross-Trip position mutation should be denied';
  exception when others then
    if sqlerrm not like '%NOT_MEMBER%' then raise; end if;
  end;

  begin
    insert into public.trip_lobby_positions(trip_id, user_id, position_x, position_y)
    values (v_trip, v_outsider, 0.2, 0.2);
    raise exception 'position for a non-member should violate the composite FK';
  exception when foreign_key_violation then
    null;
  end;

  delete from public.trip_members where trip_id = v_trip and user_id = v_member;
  if exists (select 1 from public.trip_lobby_positions where trip_id = v_trip and user_id = v_member) then
    raise exception 'member removal did not cascade Lobby position';
  end if;

  begin
    perform public.update_trip_lobby_position(v_member, v_trip, 0.3, 0.3);
    raise exception 'removed member position mutation should be denied';
  exception when others then
    if sqlerrm not like '%NOT_MEMBER%' then raise; end if;
  end;

  begin
    perform public.update_trip_lobby_position(v_owner, v_archived_trip, 0.3, 0.3);
    raise exception 'archived position mutation should be denied';
  exception when others then
    if sqlerrm not like '%TRIP_ARCHIVED%' then raise; end if;
  end;

  perform public.update_trip_lobby_position(v_owner, v_delete_trip, 0.4, 0.4);
  delete from public.trips where id = v_delete_trip;
  if exists (select 1 from public.trip_lobbies where trip_id = v_delete_trip)
     or exists (select 1 from public.trip_lobby_positions where trip_id = v_delete_trip) then
    raise exception 'Trip deletion did not cascade Lobby rows';
  end if;
end;
$$;

rollback;
