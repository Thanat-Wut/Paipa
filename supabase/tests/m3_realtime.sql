-- M3.3 Realtime publication acceptance checks. This suite is read-only.
do $$
declare
  v_table text;
begin
  foreach v_table in array array['board_notes', 'board_note_likes', 'board_note_comments', 'chat_messages'] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      raise exception 'M3.3 table % is missing from supabase_realtime', v_table;
    end if;
  end loop;
  if not exists (select 1 from pg_class where oid = 'public.board_notes'::regclass and relrowsecurity)
     or not exists (select 1 from pg_class where oid = 'public.board_note_likes'::regclass and relrowsecurity)
     or not exists (select 1 from pg_class where oid = 'public.board_note_comments'::regclass and relrowsecurity)
     or not exists (select 1 from pg_class where oid = 'public.chat_messages'::regclass and relrowsecurity) then
    raise exception 'M3.3 Realtime tables must retain RLS';
  end if;
end;
$$;
