-- M4.3 Activity acceptance checks. Fixture writes are rolled back.
begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_trip uuid := gen_random_uuid();
  v_other_trip uuid := gen_random_uuid();
  v_delete_trip uuid := gen_random_uuid();
  v_note uuid;
  v_comment uuid;
  v_poll uuid;
  v_item uuid;
  v_payment uuid := gen_random_uuid();
  v_expense uuid := gen_random_uuid();
  v_count integer;
  v_activity_id uuid;
begin
  if to_regclass('public.trip_activities') is null then raise exception 'trip_activities table missing'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.trip_activities'::regclass) then raise exception 'Activity RLS disabled'; end if;
  if has_table_privilege('anon', 'public.trip_activities', 'select') or has_table_privilege('authenticated', 'public.trip_activities', 'select') then raise exception 'Activity table exposed to browser roles'; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trip_activities') then raise exception 'Activity table is not realtime'; end if;
  if not exists (select 1 from pg_proc where proname = 'create_poll_with_activity') then raise exception 'Poll Activity wrapper missing'; end if;
  if not exists (select 1 from pg_proc where proname = 'create_plan_item_with_activity') then raise exception 'Plan Activity wrapper missing'; end if;
  if not exists (select 1 from pg_proc where proname = 'verify_payment_with_activity') then raise exception 'Payment Activity wrapper missing'; end if;
  if not exists (select 1 from pg_proc where proname = 'create_expense_with_activity') then raise exception 'Expense Activity wrapper missing'; end if;

  insert into public.profiles(id, display_name) values
    (v_owner, 'M4.3 Owner'), (v_member, 'M4.3 Member'), (v_outsider, 'M4.3 Outsider');
  insert into public.trips(id, owner_id, name, start_date, end_date, status) values
    (v_trip, v_owner, 'M4.3 activity trip', '2026-10-10', '2026-10-12', 'planning'),
    (v_other_trip, v_owner, 'M4.3 other trip', '2026-10-13', '2026-10-14', 'planning'),
    (v_delete_trip, v_owner, 'M4.3 delete trip', '2026-10-15', '2026-10-16', 'planning');
  insert into public.trip_members(trip_id, user_id, display_name, role, attendance) values
    (v_trip, v_owner, 'M4.3 Owner', 'owner', 'maybe'),
    (v_trip, v_member, 'M4.3 Member', 'member', 'maybe'),
    (v_other_trip, v_owner, 'M4.3 Owner', 'owner', 'maybe'),
    (v_delete_trip, v_owner, 'M4.3 Owner', 'owner', 'maybe');
  insert into public.contributions(trip_id, contributor_id) values (v_trip, v_owner), (v_trip, v_member);

  v_note := public.create_board_note_with_activity(v_member, v_trip, 'จุดนัดหมาย', '', 'yellow');
  v_comment := public.create_board_comment_with_activity(v_owner, v_note, 'เจอกันที่นี่นะ');
  v_poll := public.create_poll_with_activity(v_owner, v_trip, 'ไปไหนดี?', '["ทะเล", "ภูเข"]'::jsonb);
  perform public.close_poll_with_activity(v_owner, v_poll);
  v_item := public.create_plan_item_with_activity(v_member, v_trip, '2026-10-10', '09:00', 'เช็กอินโรงแรม', '', null, v_note, v_poll);
  perform public.update_plan_item_with_activity(v_member, v_item, '2026-10-11', '10:00', 'เช็กอินโรงแรมแก้ไข', '', null, v_note, v_poll);

  insert into public.payment_submissions(id, trip_id, contributor_id, client_request_id, request_hash, amount, payment_method, payment_occurred_at, proof_path, note)
  values (v_payment, v_trip, v_member, gen_random_uuid(), repeat('a', 64), 100, 'cash', now(), null, 'M4.3 payment');
  perform public.verify_payment_with_activity(v_owner, v_trip, v_payment);

  perform public.create_expense_with_activity(v_owner, v_trip, v_expense, gen_random_uuid(), repeat('b', 64), 'แท็กซี่', 100, 'transport', 'trip_fund', null, now(), '', null);

  select count(*) into v_count from public.trip_activities where trip_id = v_trip;
  if v_count <> 8 then raise exception 'Activity count mismatch: %', v_count; end if;
  if exists (select 1 from public.trip_activities where trip_id = v_trip and actor_id is null) then raise exception 'Activity actor was not recorded'; end if;
  if exists (select 1 from public.trip_activities where trip_id = v_trip and exists (select 1 from jsonb_object_keys(payload) as key where key not in ('title', 'itemTitle', 'dayDate', 'noteTitle'))) then raise exception 'Activity payload contains an unsafe key'; end if;
  if not exists (select 1 from public.trip_activities where trip_id = v_trip and type = 'poll_closed' and payload->>'title' = 'ไปไหนดี?') then raise exception 'Poll close Activity missing'; end if;
  if not exists (select 1 from public.trip_activities where trip_id = v_trip and type = 'payment_verified' and entity_id = v_payment and payload = '{}'::jsonb) then raise exception 'Payment Activity unsafe or missing'; end if;
  if not exists (select 1 from public.trip_activities where trip_id = v_trip and type = 'expense_created' and payload->>'title' = 'แท็กซี่') then raise exception 'Expense Activity missing'; end if;

  begin
    perform public.create_poll_with_activity(v_outsider, v_trip, 'No access', '["A", "B"]'::jsonb);
    raise exception 'outsider Activity mutation should fail';
  exception when others then
    if sqlerrm not like '%NOT_MEMBER%' then raise; end if;
  end;

  select id into v_activity_id from public.trip_activities where trip_id = v_trip and type = 'board_note_created' limit 1;
  delete from public.board_notes where id = v_note;
  if not exists (select 1 from public.trip_activities where id = v_activity_id) then raise exception 'source delete removed Activity history'; end if;

  v_note := public.create_board_note_with_activity(v_owner, v_delete_trip, 'Temporary', '', 'blue');
  select count(*) into v_count from public.trip_activities where trip_id = v_delete_trip;
  if v_count <> 1 then raise exception 'delete-trip Activity fixture missing'; end if;
  delete from public.trips where id = v_delete_trip;
  if exists (select 1 from public.trip_activities where trip_id = v_delete_trip) then raise exception 'Trip delete did not cascade Activity'; end if;

  if exists (select 1 from public.trip_activities where trip_id = v_other_trip) then raise exception 'Trip isolation failed'; end if;
end;
$$;

rollback;
