-- M3.3 additive Realtime publication membership for the existing Social tables.
alter publication supabase_realtime add table public.board_notes;
alter publication supabase_realtime add table public.board_note_likes;
alter publication supabase_realtime add table public.board_note_comments;
alter publication supabase_realtime add table public.chat_messages;
