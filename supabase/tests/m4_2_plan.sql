-- M4.2 Trip Plan acceptance checks. Fixture writes are rolled back.
begin;

do $$
declare
  v_owner uuid := gen_random_uuid(); v_member uuid := gen_random_uuid(); v_other uuid := gen_random_uuid();
  v_trip uuid := gen_random_uuid(); v_other_trip uuid := gen_random_uuid(); v_archived uuid := gen_random_uuid();
  v_note uuid; v_poll uuid; v_option uuid; v_item uuid; v_item2 uuid; v_count integer; v_day date;
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.trip_plan_items'::regclass and contype = 'f' and pg_get_constraintdef(oid) like '%board_note_id%') then raise exception 'plan Board Note composite FK missing'; end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.trip_plan_items'::regclass and contype = 'f' and pg_get_constraintdef(oid) like '%poll_id%') then raise exception 'plan Poll composite FK missing'; end if;
  if not exists (select 1 from pg_proc where proname = 'move_plan_item') then raise exception 'move_plan_item RPC missing'; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trip_plan_items') then raise exception 'trip_plan_items is not realtime'; end if;

  insert into public.profiles(id, display_name) values (v_owner, 'M4.2 Owner'), (v_member, 'M4.2 Member'), (v_other, 'M4.2 Other');
  insert into public.trips(id, owner_id, name, start_date, end_date, status) values
    (v_trip, v_owner, 'M4.2 plan trip', '2026-11-20', '2026-11-22', 'planning'),
    (v_other_trip, v_owner, 'M4.2 other trip', '2026-12-01', '2026-12-02', 'planning'),
    (v_archived, v_owner, 'M4.2 archived trip', '2026-12-03', '2026-12-04', 'archived');
  insert into public.trip_members(trip_id, user_id, display_name, role, attendance) values
    (v_trip, v_owner, 'M4.2 Owner', 'owner', 'maybe'), (v_trip, v_member, 'M4.2 Member', 'member', 'maybe'),
    (v_other_trip, v_owner, 'M4.2 Owner', 'owner', 'maybe'), (v_archived, v_owner, 'M4.2 Owner', 'owner', 'maybe');

  v_note := public.create_board_note(v_member, v_trip, 'Plan note', '', 'yellow');
  v_poll := public.create_poll(v_member, v_trip, 'Plan poll', '["A", "B"]'::jsonb);
  select id into v_option from public.poll_options where poll_id = v_poll order by sort_order limit 1;
  v_item := public.create_plan_item(v_member, v_trip, '2026-11-20', '09:30', 'Breakfast', 'Cafe', 'Old town', v_note, v_poll);
  if not exists (select 1 from public.trip_plan_items where id = v_item and day_date = '2026-11-20' and board_note_id = v_note and poll_id = v_poll) then raise exception 'Plan item create failed'; end if;
  v_item2 := public.create_plan_item(v_member, v_trip, '2026-11-20', null, 'Walk', '', null, null, null);
  perform public.move_plan_item(v_member, v_item2, 'up');
  select day_date into v_day from public.trip_plan_items where id = v_item2;
  if v_day <> '2026-11-20' then raise exception 'Plan reorder changed day'; end if;
  perform public.update_plan_item(v_member, v_item2, '2026-11-21', null, 'Walk moved', '', null, null, null);
  if not exists (select 1 from public.trip_plan_items where id = v_item2 and day_date = '2026-11-21') then raise exception 'Plan day move failed'; end if;

  begin perform public.create_plan_item(v_member, v_trip, '2026-12-01', null, 'Out of range', '', null, null, null); raise exception 'day range should fail'; exception when others then if sqlerrm not like '%PLAN_DAY_OUT_OF_RANGE%' then raise; end if; end;
  begin perform public.create_plan_item(v_other, v_trip, '2026-11-20', null, 'Outsider', '', null, null, null); raise exception 'outsider should fail'; exception when others then if sqlerrm not like '%NOT_MEMBER%' then raise; end if; end;
  begin perform public.create_plan_item(v_owner, v_archived, '2026-12-03', null, 'Archived', '', null, null, null); raise exception 'archived mutation should fail'; exception when others then if sqlerrm not like '%TRIP_ARCHIVED%' then raise; end if; end;
  begin perform public.create_plan_item(v_member, v_trip, '2026-11-20', null, 'Cross trip note', '', null, public.create_board_note(v_owner, v_other_trip, 'Other', '', 'blue'), null); raise exception 'cross-trip note should fail'; exception when others then if sqlerrm not like '%NOTE_NOT_FOUND%' then raise; end if; end;

  delete from public.board_notes where id = v_note;
  delete from public.polls where id = v_poll;
  if exists (select 1 from public.trip_plan_items where id = v_item and (board_note_id is not null or poll_id is not null)) then raise exception 'source delete must clear plan refs'; end if;
  begin perform public.delete_plan_item(v_other, v_item2); raise exception 'outsider delete should fail'; exception when others then if sqlerrm not like '%NOT_MEMBER%' and sqlerrm not like '%PLAN_FORBIDDEN%' then raise; end if; end;
  perform public.delete_plan_item(v_owner, v_item2);
  select count(*) into v_count from public.trip_plan_items where trip_id = v_trip;
  if v_count <> 1 then raise exception 'Plan delete count mismatch'; end if;
end $$;

rollback;
