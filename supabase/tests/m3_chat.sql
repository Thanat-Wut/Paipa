-- M3.2 Chat acceptance checks. Every fixture is rolled back at the end.
begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_former uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_trip uuid := gen_random_uuid();
  v_other_trip uuid := gen_random_uuid();
  v_archived_trip uuid := gen_random_uuid();
  v_note uuid;
  v_other_note uuid;
  v_message uuid;
  v_member_message uuid;
  v_count integer;
  v_note_id uuid;
begin
  if not exists (select 1 from pg_class where oid = 'public.chat_messages'::regclass and relrowsecurity) then
    raise exception 'chat_messages must have RLS enabled';
  end if;
  if not has_table_privilege('service_role', 'public.chat_messages', 'select') then
    raise exception 'service_role must be able to read chat_messages';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_messages'::regclass
      and conname = 'chat_messages_note_same_trip_fk'
      and pg_get_constraintdef(oid) like '%(trip_id, note_id)%'
  ) then
    raise exception 'same-Trip Note foreign key is missing';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'chat_messages'
      and indexdef like '%(trip_id, created_at, id)%'
  ) then
    raise exception 'chat ordering index is missing';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.board_notes'::regclass and conname = 'board_notes_trip_id_id_key'
  ) then
    raise exception 'board note composite uniqueness is missing';
  end if;

  insert into public.profiles(id, display_name) values
    (v_owner, 'M3.2 Owner'), (v_member, 'M3.2 Member'),
    (v_former, 'M3.2 Former'), (v_outsider, 'M3.2 Outsider');
  insert into public.trips(id, owner_id, name, start_date, end_date, status) values
    (v_trip, v_owner, 'M3.2 Chat Trip', '2026-10-10', '2026-10-11', 'planning'),
    (v_other_trip, v_owner, 'M3.2 Other Trip', '2026-10-12', '2026-10-13', 'planning'),
    (v_archived_trip, v_owner, 'M3.2 Archived Trip', '2026-10-14', '2026-10-15', 'archived');
  insert into public.trip_members(trip_id, user_id, display_name, role, attendance) values
    (v_trip, v_owner, 'M3.2 Owner', 'owner', 'maybe'),
    (v_trip, v_member, 'M3.2 Member', 'member', 'maybe'),
    (v_trip, v_former, 'M3.2 Former', 'member', 'maybe'),
    (v_other_trip, v_owner, 'M3.2 Owner', 'owner', 'maybe'),
    (v_archived_trip, v_owner, 'M3.2 Owner', 'owner', 'maybe');

  v_note := public.create_board_note(v_owner, v_trip, 'Chat note', 'Reference from chat', 'pink');
  v_other_note := public.create_board_note(v_owner, v_other_trip, 'Other trip note', 'Must not cross', 'blue');

  v_message := public.create_chat_message(v_owner, v_trip, '  owner message  ', v_note);
  if not exists (select 1 from public.chat_messages where id = v_message and content = 'owner message' and note_id = v_note) then
    raise exception 'owner chat message was not normalized or persisted';
  end if;
  v_member_message := public.create_chat_message(v_member, v_trip, 'member message', null);
  select count(*) into v_count from public.chat_messages where trip_id = v_trip;
  if v_count <> 2 then raise exception 'member chat message was not persisted'; end if;

  begin
    perform public.create_chat_message(v_member, v_trip, 'cross-trip RPC', v_other_note);
    raise exception 'cross-Trip RPC Note reference should be denied';
  exception when others then
    if sqlerrm not like '%NOTE_NOT_FOUND%' then raise; end if;
  end;
  begin
    insert into public.chat_messages(trip_id, author_id, content, note_id)
      values (v_trip, v_member, 'cross-trip direct insert', v_other_note);
    raise exception 'cross-Trip direct insert should be denied by the composite FK';
  exception when foreign_key_violation then
    null;
  end;

  begin
    perform public.create_chat_message(v_outsider, v_trip, 'outsider');
    raise exception 'outsider send should be denied';
  exception when others then
    if sqlerrm not like '%NOT_MEMBER%' then raise; end if;
  end;
  delete from public.trip_members where trip_id = v_trip and user_id = v_former;
  begin
    perform public.create_chat_message(v_former, v_trip, 'former');
    raise exception 'former member send should be denied';
  exception when others then
    if sqlerrm not like '%NOT_MEMBER%' then raise; end if;
  end;

  begin
    perform public.delete_chat_message(v_owner, v_member_message);
    raise exception 'non-author delete should be denied';
  exception when others then
    if sqlerrm not like '%NOT_MESSAGE_AUTHOR%' then raise; end if;
  end;
  perform public.delete_chat_message(v_member, v_member_message);
  if exists (select 1 from public.chat_messages where id = v_member_message) then
    raise exception 'author delete did not remove the message';
  end if;

  begin
    perform public.create_chat_message(v_owner, v_archived_trip, 'archived send');
    raise exception 'archived send should be denied';
  exception when others then
    if sqlerrm not like '%TRIP_ARCHIVED%' then raise; end if;
  end;

  select note_id into v_note_id from public.chat_messages where id = v_message;
  if v_note_id <> v_note then raise exception 'precondition Note reference missing'; end if;
  delete from public.board_notes where id = v_note;
  if not exists (select 1 from public.chat_messages where id = v_message and note_id is null) then
    raise exception 'deleting a Board Note must preserve the message and clear note_id';
  end if;
end;
$$;

rollback;
