-- M3 additive board note positions. Coordinates are normalized to the board
-- canvas so a saved layout remains portable across viewport sizes.
alter table public.board_notes
  add column position_x double precision,
  add column position_y double precision;

alter table public.board_notes
  add constraint board_notes_position_x_check
    check (position_x is null or position_x between 0 and 1),
  add constraint board_notes_position_y_check
    check (position_y is null or position_y between 0 and 1),
  add constraint board_notes_position_pair_check
    check ((position_x is null) = (position_y is null));

create or replace function public.create_board_note(
  p_actor_id uuid, p_trip_id uuid, p_title text, p_content text, p_color text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_note_id uuid;
  v_order integer;
  v_position_x double precision;
  v_position_y double precision;
begin
  perform private.board_require_member(p_actor_id, p_trip_id, false);
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120
     or char_length(coalesce(p_content, '')) > 2000
     or p_color not in ('yellow', 'pink', 'blue', 'green', 'purple') then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- Serialize allocation with other Board mutations and use a deterministic
  -- stagger for newly-created notes. Existing legacy rows stay nullable and
  -- receive a client-side fallback until the user first moves them.
  perform 1 from public.trips where id = p_trip_id for update;
  select coalesce(max(sort_order) + 1, 0)
    into v_order
    from public.board_notes
   where trip_id = p_trip_id;

  v_position_x := least(0.74::double precision, 0.04::double precision + mod(v_order, 4) * 0.23::double precision);
  v_position_y := least(0.78::double precision, 0.05::double precision + (v_order / 4) * 0.24::double precision);

  insert into public.board_notes(
    trip_id, author_id, title, content, color, sort_order, position_x, position_y
  )
  values (
    p_trip_id, p_actor_id, btrim(p_title), coalesce(p_content, ''), p_color,
    v_order, v_position_x, v_position_y
  )
  returning id into v_note_id;
  return v_note_id;
end;
$$;

create function public.update_board_note_position(
  p_actor_id uuid,
  p_note_id uuid,
  p_position_x double precision,
  p_position_y double precision
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_trip_id uuid;
begin
  select trip_id into v_trip_id
    from public.board_notes
   where id = p_note_id;
  if not found then
    raise exception 'NOTE_NOT_FOUND';
  end if;

  perform private.board_require_member(p_actor_id, v_trip_id, false);
  if p_position_x is null or p_position_y is null
     or p_position_x < 0 or p_position_x > 1
     or p_position_y < 0 or p_position_y > 1 then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- Re-check after authorization and serialize the write against another
  -- mutation that may delete the note or change its trip membership.
  perform 1 from public.board_notes where id = p_note_id for update;
  if not found then
    raise exception 'NOTE_NOT_FOUND';
  end if;

  update public.board_notes
     set position_x = p_position_x,
         position_y = p_position_y
   where id = p_note_id;
end;
$$;

revoke all on function public.update_board_note_position(uuid, uuid, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.update_board_note_position(uuid, uuid, double precision, double precision)
  to service_role;
