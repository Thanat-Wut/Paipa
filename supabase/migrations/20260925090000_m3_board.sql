create table public.board_notes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  content text not null default '' check (char_length(content) between 0 and 2000),
  color text not null default 'yellow' check (color in ('yellow', 'pink', 'blue', 'green', 'purple')),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.board_note_likes (
  note_id uuid not null references public.board_notes(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, profile_id)
);

create table public.board_note_comments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.board_notes(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  content text not null check (char_length(btrim(content)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index board_notes_trip_order_idx on public.board_notes(trip_id, sort_order, created_at, id);
create index board_notes_author_idx on public.board_notes(author_id);
create index board_note_likes_profile_idx on public.board_note_likes(profile_id);
create index board_note_comments_note_idx on public.board_note_comments(note_id, created_at, id);
create index board_note_comments_author_idx on public.board_note_comments(author_id);

create function private.set_board_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger board_notes_updated_at before update on public.board_notes
for each row execute function private.set_board_updated_at();

create trigger board_note_comments_updated_at before update on public.board_note_comments
for each row execute function private.set_board_updated_at();

alter table public.board_notes enable row level security;
alter table public.board_note_likes enable row level security;
alter table public.board_note_comments enable row level security;

revoke all on table public.board_notes, public.board_note_likes, public.board_note_comments from public, anon, authenticated;
grant select on table public.board_notes, public.board_note_likes, public.board_note_comments to service_role;

create function private.board_require_member(p_actor_id uuid, p_trip_id uuid, p_allow_archived boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if not exists (select 1 from public.profiles where id = p_actor_id) then
    raise exception 'IDENTITY_NOT_FOUND';
  end if;
  select status into v_status from public.trips where id = p_trip_id;
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

create function public.create_board_note(
  p_actor_id uuid, p_trip_id uuid, p_title text, p_content text, p_color text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_note_id uuid; v_order integer;
begin
  perform private.board_require_member(p_actor_id, p_trip_id, false);
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120
     or char_length(coalesce(p_content, '')) > 2000
     or p_color not in ('yellow', 'pink', 'blue', 'green', 'purple') then
    raise exception 'VALIDATION_ERROR';
  end if;
  perform 1 from public.trips where id = p_trip_id for update;
  select coalesce(max(sort_order) + 1, 0) into v_order from public.board_notes where trip_id = p_trip_id;
  insert into public.board_notes(trip_id, author_id, title, content, color, sort_order)
  values (p_trip_id, p_actor_id, btrim(p_title), coalesce(p_content, ''), p_color, v_order)
  returning id into v_note_id;
  return v_note_id;
end;
$$;

create function public.update_board_note(
  p_actor_id uuid, p_note_id uuid, p_title text, p_content text, p_color text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_trip_id uuid; v_author_id uuid;
begin
  select trip_id, author_id into v_trip_id, v_author_id from public.board_notes where id = p_note_id;
  if not found then raise exception 'NOTE_NOT_FOUND'; end if;
  perform private.board_require_member(p_actor_id, v_trip_id, false);
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

create function public.delete_board_note(p_actor_id uuid, p_note_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_trip_id uuid; v_author_id uuid; v_owner_id uuid;
begin
  select n.trip_id, n.author_id, t.owner_id into v_trip_id, v_author_id, v_owner_id
  from public.board_notes n join public.trips t on t.id = n.trip_id where n.id = p_note_id;
  if not found then raise exception 'NOTE_NOT_FOUND'; end if;
  perform private.board_require_member(p_actor_id, v_trip_id, false);
  if v_author_id <> p_actor_id and v_owner_id <> p_actor_id then raise exception 'NOT_NOTE_AUTHOR'; end if;
  delete from public.board_notes where id = p_note_id;
end;
$$;

create function public.toggle_board_note_like(p_actor_id uuid, p_note_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_trip_id uuid; v_liked boolean;
begin
  select trip_id into v_trip_id from public.board_notes where id = p_note_id;
  if not found then raise exception 'NOTE_NOT_FOUND'; end if;
  perform private.board_require_member(p_actor_id, v_trip_id, false);
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

create function public.create_board_note_comment(p_actor_id uuid, p_note_id uuid, p_content text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_trip_id uuid; v_comment_id uuid;
begin
  select trip_id into v_trip_id from public.board_notes where id = p_note_id;
  if not found then raise exception 'NOTE_NOT_FOUND'; end if;
  perform private.board_require_member(p_actor_id, v_trip_id, false);
  if char_length(btrim(coalesce(p_content, ''))) not between 1 and 1000 then raise exception 'VALIDATION_ERROR'; end if;
  insert into public.board_note_comments(note_id, author_id, content)
  values (p_note_id, p_actor_id, btrim(p_content)) returning id into v_comment_id;
  return v_comment_id;
end;
$$;

create function public.delete_board_note_comment(p_actor_id uuid, p_comment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_note_id uuid; v_author_id uuid; v_trip_id uuid; v_owner_id uuid;
begin
  select c.note_id, c.author_id, n.trip_id, t.owner_id into v_note_id, v_author_id, v_trip_id, v_owner_id
  from public.board_note_comments c join public.board_notes n on n.id = c.note_id
  join public.trips t on t.id = n.trip_id where c.id = p_comment_id;
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;
  perform private.board_require_member(p_actor_id, v_trip_id, false);
  if v_author_id <> p_actor_id and v_owner_id <> p_actor_id then raise exception 'NOT_COMMENT_AUTHOR'; end if;
  delete from public.board_note_comments where id = p_comment_id;
end;
$$;

create function public.move_board_note(p_actor_id uuid, p_note_id uuid, p_direction text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_trip_id uuid; v_current_order integer; v_other_id uuid; v_other_order integer; v_max_order integer;
begin
  select trip_id, sort_order into v_trip_id, v_current_order from public.board_notes where id = p_note_id;
  if not found then raise exception 'NOTE_NOT_FOUND'; end if;
  perform private.board_require_member(p_actor_id, v_trip_id, false);
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

revoke all on function private.board_require_member(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.create_board_note(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.update_board_note(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.delete_board_note(uuid, uuid) from public, anon, authenticated;
revoke all on function public.toggle_board_note_like(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_board_note_comment(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.delete_board_note_comment(uuid, uuid) from public, anon, authenticated;
revoke all on function public.move_board_note(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_board_note(uuid, uuid, text, text, text),
  public.update_board_note(uuid, uuid, text, text, text), public.delete_board_note(uuid, uuid),
  public.toggle_board_note_like(uuid, uuid), public.create_board_note_comment(uuid, uuid, text),
  public.delete_board_note_comment(uuid, uuid), public.move_board_note(uuid, uuid, text) to service_role;
