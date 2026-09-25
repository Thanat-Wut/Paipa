-- M4.1 Poll acceptance checks. Fixture writes are rolled back.
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
  v_poll uuid;
  v_other_poll uuid;
  v_option_a uuid;
  v_option_b uuid;
  v_option_c uuid;
  v_cross_option uuid;
  v_count integer;
  v_status text;
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.poll_votes'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) like '%poll_id, profile_id%'
  ) then
    raise exception 'poll_votes must enforce one vote per poll/profile';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.poll_votes'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like '%poll_id, option_id%'
  ) then
    raise exception 'poll_votes must use same-Poll composite foreign key';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'vote_poll'
      and position('for update' in lower(pg_get_functiondef(p.oid))) > 0
  ) then
    raise exception 'vote_poll must lock the Poll row for concurrency safety';
  end if;

  insert into public.profiles(id, display_name) values
    (v_owner, 'M4.1 Owner'), (v_member, 'M4.1 Member'), (v_other, 'M4.1 Other'),
    (v_former, 'M4.1 Former'), (v_outsider, 'M4.1 Outsider');
  insert into public.trips(id, owner_id, name, start_date, end_date, status) values
    (v_trip, v_owner, 'M4.1 poll trip', '2026-10-01', '2026-10-02', 'planning'),
    (v_other_trip, v_owner, 'M4.1 other poll trip', '2026-10-03', '2026-10-04', 'planning'),
    (v_archived_trip, v_owner, 'M4.1 archived poll trip', '2026-10-05', '2026-10-06', 'archived');
  insert into public.trip_members(trip_id, user_id, display_name, role, attendance) values
    (v_trip, v_owner, 'M4.1 Owner', 'owner', 'maybe'),
    (v_trip, v_member, 'M4.1 Member', 'member', 'maybe'),
    (v_trip, v_other, 'M4.1 Other', 'member', 'maybe'),
    (v_trip, v_former, 'M4.1 Former', 'member', 'maybe'),
    (v_other_trip, v_owner, 'M4.1 Owner', 'owner', 'maybe'),
    (v_archived_trip, v_owner, 'M4.1 Owner', 'owner', 'maybe');

  v_poll := public.create_poll(v_member, v_trip, '  ไปไหนดี?  ', '["ทะเล", "ภูเข", "คาเฟ่"]'::jsonb);
  select id into v_option_a from public.poll_options where poll_id = v_poll and sort_order = 0;
  select id into v_option_b from public.poll_options where poll_id = v_poll and sort_order = 1;
  select id into v_option_c from public.poll_options where poll_id = v_poll and sort_order = 2;
  if not exists (select 1 from public.polls where id = v_poll and question = 'ไปไหนดี?' and status = 'open') then
    raise exception 'member Poll was not normalized or opened';
  end if;
  select count(*) into v_count from public.poll_options where poll_id = v_poll;
  if v_count <> 3 then raise exception 'Poll option count mismatch'; end if;

  begin
    perform public.create_poll(v_member, v_trip, 'Too few', '["one"]'::jsonb);
    raise exception 'minimum option validation should fail';
  exception when others then
    if sqlerrm not like '%VALIDATION_ERROR%' then raise; end if;
  end;
  begin
    perform public.create_poll(v_member, v_trip, 'Duplicate', '["one", " ONE "]'::jsonb);
    raise exception 'duplicate option validation should fail';
  exception when others then
    if sqlerrm not like '%VALIDATION_ERROR%' then raise; end if;
  end;
  begin
    perform public.create_poll(v_outsider, v_trip, 'No access', '["one", "two"]'::jsonb);
    raise exception 'outsider create should fail';
  exception when others then
    if sqlerrm not like '%NOT_MEMBER%' then raise; end if;
  end;
  delete from public.trip_members where trip_id = v_trip and user_id = v_former;
  begin
    perform public.create_poll(v_former, v_trip, 'Former', '["one", "two"]'::jsonb);
    raise exception 'former create should fail';
  exception when others then
    if sqlerrm not like '%NOT_MEMBER%' then raise; end if;
  end;

  perform public.vote_poll(v_member, v_poll, v_option_a);
  perform public.vote_poll(v_member, v_poll, v_option_b);
  select count(*) into v_count from public.poll_votes where poll_id = v_poll and profile_id = v_member;
  if v_count <> 1 then raise exception 'vote replacement created duplicate rows'; end if;
  if not exists (select 1 from public.poll_votes where poll_id = v_poll and profile_id = v_member and option_id = v_option_b) then
    raise exception 'vote replacement did not move the current vote';
  end if;
  perform public.remove_poll_vote(v_member, v_poll);
  if exists (select 1 from public.poll_votes where poll_id = v_poll and profile_id = v_member) then
    raise exception 'remove vote did not delete current vote';
  end if;

  v_other_poll := public.create_poll(v_owner, v_other_trip, 'Other Trip', '["only", "here"]'::jsonb);
  select id into v_cross_option from public.poll_options where poll_id = v_other_poll and sort_order = 0;
  begin
    insert into public.poll_votes(poll_id, option_id, profile_id) values (v_poll, v_cross_option, v_member);
    raise exception 'cross-Poll direct vote insert should fail';
  exception when foreign_key_violation then
    null;
  end;
  begin
    perform public.vote_poll(v_member, v_poll, (select id from public.poll_options where poll_id = v_other_poll limit 1));
    raise exception 'cross-Poll option vote should fail';
  exception when others then
    if sqlerrm not like '%OPTION_NOT_FOUND%' then raise; end if;
  end;
  begin
    perform public.close_poll(v_other, v_poll);
    raise exception 'non-creator/member close should fail';
  exception when others then
    if sqlerrm not like '%NOT_POLL_CREATOR%' then raise; end if;
  end;
  perform public.close_poll(v_owner, v_poll);
  select status into v_status from public.polls where id = v_poll;
  if v_status <> 'closed' then raise exception 'Poll did not close'; end if;
  begin
    perform public.vote_poll(v_member, v_poll, v_option_c);
    raise exception 'closed vote should fail';
  exception when others then
    if sqlerrm not like '%POLL_CLOSED%' then raise; end if;
  end;
  perform public.delete_poll(v_owner, v_poll);
  if exists (select 1 from public.poll_options where poll_id = v_poll)
     or exists (select 1 from public.poll_votes where poll_id = v_poll)
     or exists (select 1 from public.polls where id = v_poll) then
    raise exception 'Poll cascade deletion failed';
  end if;

  begin
    perform public.create_poll(v_owner, v_archived_trip, 'Archived', '["one", "two"]'::jsonb);
    raise exception 'archived create should fail';
  exception when others then
    if sqlerrm not like '%TRIP_ARCHIVED%' then raise; end if;
  end;
end;
$$;

rollback;
