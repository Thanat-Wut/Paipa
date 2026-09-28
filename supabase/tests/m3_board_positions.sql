-- Board position persistence acceptance checks. Every fixture is rolled back.
begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_former uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_trip uuid := gen_random_uuid();
  v_other_trip uuid := gen_random_uuid();
  v_archived_trip uuid := gen_random_uuid();
  v_note uuid;
  v_second_note uuid;
  v_other_note uuid;
  v_x double precision;
  v_y double precision;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'board_notes' and column_name = 'position_x'
      and data_type = 'double precision'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'board_notes' and column_name = 'position_y'
      and data_type = 'double precision'
  ) then
    raise exception 'board note position columns are missing';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_board_note_position'
      and p.oid::regprocedure::text = 'update_board_note_position(uuid,uuid,double precision,double precision)'
      and position('for update' in lower(pg_get_functiondef(p.oid))) > 0
  ) then
    raise exception 'position update RPC must exist and lock the note row';
  end if;

  insert into public.profiles(id, display_name) values
    (v_owner, 'Position Owner'), (v_member, 'Position Member'), (v_other, 'Position Other'),
    (v_former, 'Position Former'), (v_outsider, 'Position Outsider');
  insert into public.trips(id, owner_id, name, start_date, end_date, status) values
    (v_trip, v_owner, 'Position trip', '2026-10-01', '2026-10-02', 'planning'),
    (v_other_trip, v_other, 'Other position trip', '2026-10-03', '2026-10-04', 'planning'),
    (v_archived_trip, v_owner, 'Archived position trip', '2026-10-05', '2026-10-06', 'archived');
  insert into public.trip_members(trip_id, user_id, display_name, role, attendance) values
    (v_trip, v_owner, 'Position Owner', 'owner', 'maybe'),
    (v_trip, v_member, 'Position Member', 'member', 'maybe'),
    (v_trip, v_former, 'Position Former', 'member', 'maybe'),
    (v_other_trip, v_other, 'Position Other', 'owner', 'maybe'),
    (v_archived_trip, v_owner, 'Position Owner', 'owner', 'maybe');

  v_note := public.create_board_note(v_member, v_trip, 'Position note', 'Move me', 'yellow');
  v_second_note := public.create_board_note(v_owner, v_trip, 'Second position note', 'Do not overlap', 'pink');
  select position_x, position_y into v_x, v_y from public.board_notes where id = v_note;
  if v_x is null or v_y is null or v_x < 0 or v_x > 1 or v_y < 0 or v_y > 1 then
    raise exception 'new note position was not initialized';
  end if;
  if exists (
    select 1 from public.board_notes a join public.board_notes b on b.id = v_second_note
    where a.id = v_note and a.position_x = b.position_x and a.position_y = b.position_y
  ) then
    raise exception 'new notes received identical positions';
  end if;

  perform public.update_board_note_position(v_member, v_note, 0.61, 0.29);
  select position_x, position_y into v_x, v_y from public.board_notes where id = v_note;
  if abs(v_x - 0.61) > 0.0000001 or abs(v_y - 0.29) > 0.0000001 then
    raise exception 'member position update did not persist';
  end if;

  begin
    perform public.update_board_note_position(v_outsider, v_note, 0.1, 0.1);
    raise exception 'outsider position update should be denied';
  exception when others then
    if sqlerrm not like '%NOT_MEMBER%' then raise; end if;
  end;

  delete from public.trip_members where trip_id = v_trip and user_id = v_former;
  begin
    perform public.update_board_note_position(v_former, v_note, 0.1, 0.1);
    raise exception 'former member position update should be denied';
  exception when others then
    if sqlerrm not like '%NOT_MEMBER%' then raise; end if;
  end;

  update public.trips set status = 'archived' where id = v_trip;
  begin
    perform public.update_board_note_position(v_member, v_note, 0.1, 0.1);
    raise exception 'archived position update should be denied';
  exception when others then
    if sqlerrm not like '%TRIP_ARCHIVED%' then raise; end if;
  end;

  v_other_note := public.create_board_note(v_other, v_other_trip, 'Other Trip note', '', 'blue');
  begin
    perform public.update_board_note_position(v_member, v_other_note, 0.2, 0.2);
    raise exception 'cross-Trip position update should be denied';
  exception when others then
    if sqlerrm not like '%NOT_MEMBER%' then raise; end if;
  end;
end;
$$;

rollback;
