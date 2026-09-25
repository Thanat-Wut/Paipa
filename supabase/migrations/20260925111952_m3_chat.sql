-- M3.2 lightweight Trip Chat and Board Note references.

alter table public.board_notes
  add constraint board_notes_trip_id_id_key unique (trip_id, id);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  content text not null check (char_length(btrim(content)) between 1 and 2000),
  note_id uuid null,
  created_at timestamptz not null default now(),
  constraint chat_messages_note_same_trip_fk
    foreign key (trip_id, note_id)
    references public.board_notes(trip_id, id)
    on delete set null (note_id)
);

create index chat_messages_trip_created_idx
  on public.chat_messages(trip_id, created_at, id);

alter table public.chat_messages enable row level security;
revoke all on table public.chat_messages from public, anon, authenticated;
grant select on table public.chat_messages to service_role;

create function public.create_chat_message(
  p_actor_id uuid,
  p_trip_id uuid,
  p_content text,
  p_note_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_message_id uuid;
  v_note_trip_id uuid;
begin
  perform private.board_require_member(p_actor_id, p_trip_id, false);
  if char_length(btrim(coalesce(p_content, ''))) not between 1 and 2000 then
    raise exception 'VALIDATION_ERROR';
  end if;
  if p_note_id is not null then
    select trip_id into v_note_trip_id from public.board_notes where id = p_note_id;
    if not found or v_note_trip_id <> p_trip_id then
      raise exception 'NOTE_NOT_FOUND';
    end if;
  end if;
  insert into public.chat_messages(trip_id, author_id, content, note_id)
  values (p_trip_id, p_actor_id, btrim(p_content), p_note_id)
  returning id into v_message_id;
  return v_message_id;
end;
$$;

create function public.delete_chat_message(p_actor_id uuid, p_message_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_trip_id uuid;
  v_author_id uuid;
begin
  select trip_id, author_id into v_trip_id, v_author_id
  from public.chat_messages where id = p_message_id;
  if not found then raise exception 'MESSAGE_NOT_FOUND'; end if;
  perform private.board_require_member(p_actor_id, v_trip_id, false);
  if v_author_id <> p_actor_id then raise exception 'NOT_MESSAGE_AUTHOR'; end if;
  delete from public.chat_messages where id = p_message_id;
end;
$$;

revoke all on function public.create_chat_message(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.delete_chat_message(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_chat_message(uuid, uuid, text, uuid),
  public.delete_chat_message(uuid, uuid) to service_role;
