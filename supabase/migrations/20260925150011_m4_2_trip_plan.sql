-- M4.2 collaborative Trip Plan. Days are derived from trips.start_date/end_date.
alter table public.polls add constraint polls_trip_id_id_key unique (trip_id, id);

create table public.trip_plan_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_date date not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  start_time time without time zone,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) between 0 and 1000),
  location_text text check (location_text is null or char_length(location_text) <= 200),
  sort_order integer not null default 0 check (sort_order >= 0),
  board_note_id uuid,
  poll_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trip_plan_items_board_note_fk foreign key (trip_id, board_note_id)
    references public.board_notes(trip_id, id) on delete set null (board_note_id),
  constraint trip_plan_items_poll_fk foreign key (trip_id, poll_id)
    references public.polls(trip_id, id) on delete set null (poll_id)
);

create index trip_plan_items_trip_day_order_idx
  on public.trip_plan_items(trip_id, day_date, sort_order, start_time, created_at, id);
create index trip_plan_items_created_by_idx on public.trip_plan_items(created_by);

create function private.set_plan_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create function private.plan_validate_day() returns trigger
language plpgsql set search_path = '' as $$
declare v_start date; v_end date;
begin
  select start_date, end_date into v_start, v_end from public.trips where id = new.trip_id;
  if not found then raise exception 'TRIP_NOT_FOUND'; end if;
  if new.day_date < v_start or new.day_date > v_end then raise exception 'PLAN_DAY_OUT_OF_RANGE'; end if;
  return new;
end;
$$;

create trigger trip_plan_items_updated_at before update on public.trip_plan_items
for each row execute function private.set_plan_updated_at();
create trigger trip_plan_items_day_check before insert or update on public.trip_plan_items
for each row execute function private.plan_validate_day();

alter table public.trip_plan_items enable row level security;
revoke all on table public.trip_plan_items from public, anon, authenticated;
grant select on table public.trip_plan_items to service_role;

create function public.create_plan_item(
  p_actor_id uuid, p_trip_id uuid, p_day_date date, p_start_time time,
  p_title text, p_description text, p_location_text text,
  p_board_note_id uuid, p_poll_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_item_id uuid; v_order integer;
begin
  perform private.board_require_member(p_actor_id, p_trip_id, false);
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 160
     or char_length(coalesce(p_description, '')) > 1000
     or char_length(coalesce(p_location_text, '')) > 200 then raise exception 'VALIDATION_ERROR'; end if;
  if p_board_note_id is not null and not exists (select 1 from public.board_notes where trip_id = p_trip_id and id = p_board_note_id) then raise exception 'NOTE_NOT_FOUND'; end if;
  if p_poll_id is not null and not exists (select 1 from public.polls where trip_id = p_trip_id and id = p_poll_id) then raise exception 'POLL_NOT_FOUND'; end if;
  perform 1 from public.trips where id = p_trip_id for update;
  select coalesce(max(sort_order) + 1, 0) into v_order from public.trip_plan_items where trip_id = p_trip_id and day_date = p_day_date;
  insert into public.trip_plan_items(trip_id, day_date, created_by, start_time, title, description, location_text, sort_order, board_note_id, poll_id)
  values (p_trip_id, p_day_date, p_actor_id, p_start_time, btrim(p_title), coalesce(p_description, ''), nullif(btrim(coalesce(p_location_text, '')), ''), v_order, p_board_note_id, p_poll_id)
  returning id into v_item_id;
  return v_item_id;
end;
$$;

create function public.update_plan_item(
  p_actor_id uuid, p_item_id uuid, p_day_date date, p_start_time time,
  p_title text, p_description text, p_location_text text,
  p_board_note_id uuid, p_poll_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare v_trip_id uuid; v_old_day date; v_order integer;
begin
  select trip_id, day_date into v_trip_id, v_old_day from public.trip_plan_items where id = p_item_id for update;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  perform private.board_require_member(p_actor_id, v_trip_id, false);
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 160 or char_length(coalesce(p_description, '')) > 1000 or char_length(coalesce(p_location_text, '')) > 200 then raise exception 'VALIDATION_ERROR'; end if;
  if p_board_note_id is not null and not exists (select 1 from public.board_notes where trip_id = v_trip_id and id = p_board_note_id) then raise exception 'NOTE_NOT_FOUND'; end if;
  if p_poll_id is not null and not exists (select 1 from public.polls where trip_id = v_trip_id and id = p_poll_id) then raise exception 'POLL_NOT_FOUND'; end if;
  if p_day_date <> v_old_day then
    select coalesce(max(sort_order) + 1, 0) into v_order from public.trip_plan_items where trip_id = v_trip_id and day_date = p_day_date;
  else
    select sort_order into v_order from public.trip_plan_items where id = p_item_id;
  end if;
  update public.trip_plan_items set day_date = p_day_date, start_time = p_start_time, title = btrim(p_title), description = coalesce(p_description, ''), location_text = nullif(btrim(coalesce(p_location_text, '')), ''), sort_order = v_order, board_note_id = p_board_note_id, poll_id = p_poll_id where id = p_item_id;
end;
$$;

create function public.move_plan_item(p_actor_id uuid, p_item_id uuid, p_direction text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_trip_id uuid; v_day date; v_current integer; v_other_id uuid; v_other integer; v_max integer;
begin
  select trip_id, day_date, sort_order into v_trip_id, v_day, v_current from public.trip_plan_items where id = p_item_id for update;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  perform private.board_require_member(p_actor_id, v_trip_id, false);
  if p_direction not in ('up', 'down') then raise exception 'VALIDATION_ERROR'; end if;
  if p_direction = 'up' then
    select id, sort_order into v_other_id, v_other from public.trip_plan_items where trip_id = v_trip_id and day_date = v_day and sort_order < v_current order by sort_order desc, created_at desc, id desc limit 1;
  else
    select id, sort_order into v_other_id, v_other from public.trip_plan_items where trip_id = v_trip_id and day_date = v_day and sort_order > v_current order by sort_order, created_at, id limit 1;
  end if;
  if v_other_id is null then return; end if;
  select coalesce(max(sort_order) + 1, 0) into v_max from public.trip_plan_items where trip_id = v_trip_id and day_date = v_day;
  update public.trip_plan_items set sort_order = v_max where id = p_item_id;
  update public.trip_plan_items set sort_order = v_current where id = v_other_id;
  update public.trip_plan_items set sort_order = v_other where id = p_item_id;
end;
$$;

create function public.delete_plan_item(p_actor_id uuid, p_item_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_trip_id uuid; v_created_by uuid; v_owner_id uuid;
begin
  select i.trip_id, i.created_by, t.owner_id into v_trip_id, v_created_by, v_owner_id from public.trip_plan_items i join public.trips t on t.id = i.trip_id where i.id = p_item_id for update;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  perform private.board_require_member(p_actor_id, v_trip_id, false);
  if v_created_by <> p_actor_id and v_owner_id <> p_actor_id then raise exception 'PLAN_FORBIDDEN'; end if;
  delete from public.trip_plan_items where id = p_item_id;
end;
$$;

revoke all on function public.create_plan_item(uuid, uuid, date, time, text, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.update_plan_item(uuid, uuid, date, time, text, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.move_plan_item(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.delete_plan_item(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_plan_item(uuid, uuid, date, time, text, text, text, uuid, uuid), public.update_plan_item(uuid, uuid, date, time, text, text, text, uuid, uuid), public.move_plan_item(uuid, uuid, text), public.delete_plan_item(uuid, uuid) to service_role;

alter publication supabase_realtime add table public.trip_plan_items;
