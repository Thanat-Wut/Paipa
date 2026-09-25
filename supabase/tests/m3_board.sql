-- M3.1 Board acceptance checks. Every fixture is rolled back at the end.
begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_former uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_trip uuid := gen_random_uuid();
  v_archived_trip uuid := gen_random_uuid();
  v_note uuid;
  v_second_note uuid;
  v_comment uuid;
  v_liked boolean;
  v_count integer;
  v_order integer;
begin
  if not exists (
    select 1
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'board_require_member'
      and position('for update' in lower(pg_get_functiondef(p.oid))) > 0
  ) then
    raise exception 'board membership guard must lock the trip row';
  end if;
  if not exists (
    select 1
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'toggle_board_note_like'
      and position('for update' in lower(pg_get_functiondef(p.oid))) > 0
  ) then
    raise exception 'like toggle must lock the note row';
  end if;
  if not exists (
    select 1
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'move_board_note'
      and position('for update' in lower(pg_get_functiondef(p.oid))) > 0
  ) then
    raise exception 'note ordering must lock the note row';
  end if;

  insert into public.profiles(id, display_name) values
    (v_owner, 'M3 Owner'), (v_member, 'M3 Member'), (v_other, 'M3 Other'),
    (v_former, 'M3 Former'), (v_outsider, 'M3 Outsider');
  insert into public.trips(id, owner_id, name, start_date, end_date, status) values
    (v_trip, v_owner, 'M3 board trip', '2026-10-01', '2026-10-02', 'planning'),
    (v_archived_trip, v_owner, 'M3 archived board trip', '2026-10-03', '2026-10-04', 'archived');
  insert into public.trip_members(trip_id, user_id, display_name, role, attendance) values
    (v_trip, v_owner, 'M3 Owner', 'owner', 'maybe'),
    (v_trip, v_member, 'M3 Member', 'member', 'maybe'),
    (v_trip, v_other, 'M3 Other', 'member', 'maybe'),
    (v_trip, v_former, 'M3 Former', 'member', 'maybe'),
    (v_archived_trip, v_owner, 'M3 Owner', 'owner', 'maybe');

  v_note := public.create_board_note(v_member, v_trip, '  ร้านอาหาร  ', '  ลองร้านนี้กัน  ', 'pink');
  if not exists (select 1 from public.board_notes where id = v_note and title = 'ร้านอาหาร' and color = 'pink') then
    raise exception 'member note was not normalized';
  end if;

  begin
    perform public.create_board_note(v_outsider, v_trip, 'No access', '', 'yellow');
    raise exception 'outsider create should be denied';
  exception when others then
    if sqlerrm not like '%NOT_MEMBER%' then raise; end if;
  end;
  delete from public.trip_members where trip_id = v_trip and user_id = v_former;
  begin
    perform public.create_board_note(v_former, v_trip, 'Former', '', 'yellow');
    raise exception 'former member create should be denied';
  exception when others then
    if sqlerrm not like '%NOT_MEMBER%' then raise; end if;
  end;

  perform public.update_board_note(v_member, v_note, 'Updated idea', 'New detail', 'blue');
  if not exists (select 1 from public.board_notes where id = v_note and title = 'Updated idea' and color = 'blue') then
    raise exception 'author update failed';
  end if;
  begin
    perform public.update_board_note(v_other, v_note, 'Nope', '', 'yellow');
    raise exception 'other member update should be denied';
  exception when others then
    if sqlerrm not like '%NOT_NOTE_AUTHOR%' then raise; end if;
  end;

  v_second_note := public.create_board_note(v_owner, v_trip, 'Second idea', '', 'green');
  perform public.move_board_note(v_member, v_note, 'down');
  select sort_order into v_order from public.board_notes where id = v_note;
  if v_order <= (select sort_order from public.board_notes where id = v_second_note) then
    raise exception 'note order did not move down';
  end if;
  perform public.move_board_note(v_member, v_note, 'up');

  v_liked := public.toggle_board_note_like(v_owner, v_note);
  if not v_liked then raise exception 'first like should be true'; end if;
  v_liked := public.toggle_board_note_like(v_owner, v_note);
  if v_liked then raise exception 'second like should be false'; end if;
  v_liked := public.toggle_board_note_like(v_owner, v_note);
  if not v_liked then raise exception 'third like should be true'; end if;
  select count(*) into v_count from public.board_note_likes where note_id = v_note and profile_id = v_owner;
  if v_count <> 1 then raise exception 'like uniqueness failed'; end if;

  v_comment := public.create_board_note_comment(v_owner, v_note, 'เห็นด้วยเลย');
  if not exists (select 1 from public.board_note_comments where id = v_comment and content = 'เห็นด้วยเลย') then
    raise exception 'comment create failed';
  end if;
  begin
    perform public.delete_board_note_comment(v_other, v_comment);
    raise exception 'other member comment delete should be denied';
  exception when others then
    if sqlerrm not like '%NOT_COMMENT_AUTHOR%' then raise; end if;
  end;
  perform public.delete_board_note_comment(v_owner, v_comment);

  begin
    perform public.create_board_note(v_owner, v_archived_trip, 'Archived', '', 'yellow');
    raise exception 'archived create should be denied';
  exception when others then
    if sqlerrm not like '%TRIP_ARCHIVED%' then raise; end if;
  end;

  v_comment := public.create_board_note_comment(v_member, v_note, 'Cascade me');
  perform public.toggle_board_note_like(v_member, v_note);
  delete from public.board_notes where id = v_note;
  if exists (select 1 from public.board_note_likes where note_id = v_note)
     or exists (select 1 from public.board_note_comments where note_id = v_note) then
    raise exception 'note child rows did not cascade';
  end if;
  if exists (select 1 from public.board_notes where id = v_note) then raise exception 'note delete failed'; end if;
end;
$$;

rollback;
