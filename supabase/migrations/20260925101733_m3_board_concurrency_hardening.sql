-- M3.1 additive hardening: serialize board mutations on the trip row and
-- re-check rows after waiting for concurrent mutations to finish.

create or replace function private.board_require_member(p_actor_id uuid, p_trip_id uuid, p_allow_archived boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if not exists (select 1 from public.profiles where id = p_actor_id) then
    raise exception 'IDENTITY_NOT_FOUND';
  end if;
  select status into v_status from public.trips where id = p_trip_id for update;
  if not found then raise exception 'TRIP_NOT_FOUND'; end if;
  if not exists (
    select 1 from public.trips t where t.id = p_trip_id and (
      t.owner_id = p_actor_id
      or exists (select 1 from public.trip_members m where m.trip_id = t.id and m.user_id = p_actor_id)
    )
  ) then raise exception 'NOT_MEMBER'; end if;
  if not p_allow_archived and v_status = 'archived' then raise exception 'TRIP_ARCHIVED'; end if;
end;
$$;

create or replace function public.update_board_note(
  p_actor_id uuid, p_note_id uuid, p_title text, p_content text, p_color text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_trip_id uuid; v_author_id uuid;
begin
  select trip_id into v_trip_id from public.board_notes where id = p_note_id;
  if not found then raise exception 'NOTE_NOT_FOUND'; end if;
  perform private.board_require_member(p_actor_id, v_trip_id, false);
  select author_id into v_author_id from public.board_notes where id = p_note_id for update;
  if not found then raise exception 'NOTE_NOT_FOUND'; end if;
  if v_author_id <> p_actor_id then raise exception 'NOT_NOTE_AUTHOR'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120
     or char_length(coalesce(p_content, '')) > 2000
     or p_color not in ('yellow', 'pink', 'blue', 'green', 'purple') then
    raise exception 'VALIDATION_ERROR';
  end if;
  update public.board_notes
  set title = btrim(p_title), content = coalesce(p_content, ''), color = p_color
  where id = p_note_id;
end;
$$;

create or replace function public.delete_board_note(p_actor_id uuid, p_note_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_trip_id uuid; v_author_id uuid; v_owner_id uuid;
begin
  select n.trip_id, n.author_id, t.owner_id into v_trip_id, v_author_id, v_owner_id
  from public.board_notes n join public.trips t on t.id = n.trip_id where n.id = p_note_id;
  if not found then raise exception 'NOTE_NOT_FOUND'; end if;
  perform private.board_require_member(p_actor_id, v_trip_id, false);
  select n.author_id, t.owner_id into v_author_id, v_owner_id
  from public.board_notes n join public.trips t on t.id = n.trip_id
  where n.id = p_note_id for update;
  if not found then raise exception 'NOTE_NOT_FOUND'; end if;
  if v_author_id <> p_actor_id and v_owner_id <> p_actor_id then raise exception 'NOT_NOTE_AUTHOR'; end if;
  delete from public.board_notes where id = p_note_id;
end;
$$;

create or replace function public.toggle_board_note_like(p_actor_id uuid, p_note_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_trip_id uuid; v_liked boolean;
begin
  select trip_id into v_trip_id from public.board_notes where id = p_note_id;
  if not found then raise exception 'NOTE_NOT_FOUND'; end if;
  perform private.board_require_member(p_actor_id, v_trip_id, false);
  select trip_id into v_trip_id from public.board_notes where id = p_note_id for update;
  if not found then raise exception 'NOTE_NOT_FOUND'; end if;
  if exists (select 1 from public.board_note_likes where note_id = p_note_id and profile_id = p_actor_id) then
    delete from public.board_note_likes where note_id = p_note_id and profile_id = p_actor_id;
    v_liked := false;
  else
    insert into public.board_note_likes(note_id, profile_id) values (p_note_id, p_actor_id);
    v_liked := true;
  end if;
  return v_liked;
end;
$$;

create or replace function public.create_board_note_comment(p_actor_id uuid, p_note_id uuid, p_content text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_trip_id uuid; v_comment_id uuid;
begin
  select trip_id into v_trip_id from public.board_notes where id = p_note_id;
  if not found then raise exception 'NOTE_NOT_FOUND'; end if;
  perform private.board_require_member(p_actor_id, v_trip_id, false);
  select trip_id into v_trip_id from public.board_notes where id = p_note_id for update;
  if not found then raise exception 'NOTE_NOT_FOUND'; end if;
  if char_length(btrim(coalesce(p_content, ''))) not between 1 and 1000 then raise exception 'VALIDATION_ERROR'; end if;
  insert into public.board_note_comments(note_id, author_id, content)
  values (p_note_id, p_actor_id, btrim(p_content)) returning id into v_comment_id;
  return v_comment_id;
end;
$$;

create or replace function public.delete_board_note_comment(p_actor_id uuid, p_comment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_note_id uuid; v_author_id uuid; v_trip_id uuid; v_owner_id uuid;
begin
  select c.note_id, c.author_id, n.trip_id, t.owner_id into v_note_id, v_author_id, v_trip_id, v_owner_id
  from public.board_note_comments c join public.board_notes n on n.id = c.note_id
  join public.trips t on t.id = n.trip_id where c.id = p_comment_id;
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;
  perform private.board_require_member(p_actor_id, v_trip_id, false);
  select c.note_id, c.author_id into v_note_id, v_author_id
  from public.board_note_comments c where c.id = p_comment_id for update;
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;
  select owner_id into v_owner_id from public.trips where id = v_trip_id;
  if v_author_id <> p_actor_id and v_owner_id <> p_actor_id then raise exception 'NOT_COMMENT_AUTHOR'; end if;
  delete from public.board_note_comments where id = p_comment_id;
end;
$$;

create or replace function public.move_board_note(p_actor_id uuid, p_note_id uuid, p_direction text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_trip_id uuid; v_current_order integer; v_other_id uuid; v_other_order integer; v_max_order integer;
begin
  select trip_id into v_trip_id from public.board_notes where id = p_note_id;
  if not found then raise exception 'NOTE_NOT_FOUND'; end if;
  perform private.board_require_member(p_actor_id, v_trip_id, false);
  select trip_id, sort_order into v_trip_id, v_current_order from public.board_notes where id = p_note_id for update;
  if not found then raise exception 'NOTE_NOT_FOUND'; end if;
  if p_direction not in ('up', 'down') then raise exception 'VALIDATION_ERROR'; end if;
  if p_direction = 'up' then
    select id, sort_order into v_other_id, v_other_order from public.board_notes
    where trip_id = v_trip_id and sort_order < v_current_order
    order by sort_order desc, created_at desc, id desc limit 1;
  else
    select id, sort_order into v_other_id, v_other_order from public.board_notes
    where trip_id = v_trip_id and sort_order > v_current_order
    order by sort_order, created_at, id limit 1;
  end if;
  if v_other_id is null then return; end if;
  select coalesce(max(sort_order) + 1, 0) into v_max_order from public.board_notes where trip_id = v_trip_id;
  update public.board_notes set sort_order = v_max_order where id = p_note_id;
  update public.board_notes set sort_order = v_current_order where id = v_other_id;
  update public.board_notes set sort_order = v_other_order where id = p_note_id;
end;
$$;
