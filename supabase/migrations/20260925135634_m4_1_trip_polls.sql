-- M4.1 single-choice Trip Polls with server-authorized mutations.

create table public.polls (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  question text not null check (char_length(btrim(question)) between 1 and 240),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint polls_closed_at_state_check check (
    (status = 'open' and closed_at is null)
    or (status = 'closed' and closed_at is not null)
  )
);

create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 120),
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  constraint poll_options_poll_id_id_key unique (poll_id, id),
  constraint poll_options_poll_order_key unique (poll_id, sort_order)
);

create table public.poll_votes (
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (poll_id, profile_id),
  constraint poll_votes_same_poll_option_fk
    foreign key (poll_id, option_id)
    references public.poll_options(poll_id, id)
    on delete cascade
);

create index polls_trip_created_idx on public.polls(trip_id, created_at, id);
create index poll_options_poll_order_idx on public.poll_options(poll_id, sort_order, id);
create index poll_votes_poll_idx on public.poll_votes(poll_id);
create index poll_votes_option_idx on public.poll_votes(option_id);

create function private.set_poll_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger polls_updated_at before update on public.polls
for each row execute function private.set_poll_updated_at();

create trigger poll_votes_updated_at before update on public.poll_votes
for each row execute function private.set_poll_updated_at();

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
revoke all on table public.polls, public.poll_options, public.poll_votes from public, anon, authenticated;
grant select on table public.polls, public.poll_options, public.poll_votes to service_role;

create function public.create_poll(
  p_actor_id uuid,
  p_trip_id uuid,
  p_question text,
  p_options jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_poll_id uuid;
  v_invalid_count integer;
begin
  perform private.board_require_member(p_actor_id, p_trip_id, false);
  if char_length(btrim(coalesce(p_question, ''))) not between 1 and 240
     or p_options is null
     or jsonb_typeof(p_options) <> 'array'
     or jsonb_array_length(p_options) not between 2 and 10 then
    raise exception 'VALIDATION_ERROR';
  end if;
  select count(*) into v_invalid_count
  from jsonb_array_elements(p_options) as item
  where jsonb_typeof(item) <> 'string'
     or char_length(btrim(item #>> '{}')) not between 1 and 120;
  if v_invalid_count > 0 then raise exception 'VALIDATION_ERROR'; end if;
  if exists (
    select 1 from (
      select lower(btrim(value)) as normalized
      from jsonb_array_elements_text(p_options)
    ) labels
    group by normalized
    having count(*) > 1
  ) then
    raise exception 'VALIDATION_ERROR';
  end if;
  insert into public.polls(trip_id, created_by, question)
  values (p_trip_id, p_actor_id, btrim(p_question))
  returning id into v_poll_id;
  insert into public.poll_options(poll_id, label, sort_order)
  select v_poll_id, btrim(value), (ordinality - 1)::integer
  from jsonb_array_elements_text(p_options) with ordinality;
  return v_poll_id;
end;
$$;

create function public.vote_poll(
  p_actor_id uuid,
  p_poll_id uuid,
  p_option_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_trip_id uuid;
  v_status text;
begin
  select trip_id into v_trip_id from public.polls where id = p_poll_id;
  if not found then raise exception 'POLL_NOT_FOUND'; end if;
  perform private.board_require_member(p_actor_id, v_trip_id, false);
  select status into v_status from public.polls where id = p_poll_id for update;
  if v_status = 'closed' then raise exception 'POLL_CLOSED'; end if;
  if not exists (select 1 from public.poll_options where poll_id = p_poll_id and id = p_option_id) then
    raise exception 'OPTION_NOT_FOUND';
  end if;
  insert into public.poll_votes(poll_id, option_id, profile_id)
  values (p_poll_id, p_option_id, p_actor_id)
  on conflict (poll_id, profile_id) do update
    set option_id = excluded.option_id, updated_at = now();
end;
$$;

create function public.remove_poll_vote(p_actor_id uuid, p_poll_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_trip_id uuid;
  v_status text;
begin
  select trip_id into v_trip_id from public.polls where id = p_poll_id;
  if not found then raise exception 'POLL_NOT_FOUND'; end if;
  perform private.board_require_member(p_actor_id, v_trip_id, false);
  select status into v_status from public.polls where id = p_poll_id for update;
  if v_status = 'closed' then raise exception 'POLL_CLOSED'; end if;
  delete from public.poll_votes where poll_id = p_poll_id and profile_id = p_actor_id;
end;
$$;

create function public.close_poll(p_actor_id uuid, p_poll_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_trip_id uuid;
  v_created_by uuid;
  v_owner_id uuid;
  v_status text;
begin
  select p.trip_id, p.created_by, p.status, t.owner_id
    into v_trip_id, v_created_by, v_status, v_owner_id
  from public.polls p join public.trips t on t.id = p.trip_id
  where p.id = p_poll_id;
  if not found then raise exception 'POLL_NOT_FOUND'; end if;
  perform private.board_require_member(p_actor_id, v_trip_id, false);
  select status, created_by into v_status, v_created_by from public.polls where id = p_poll_id for update;
  if v_created_by <> p_actor_id and v_owner_id <> p_actor_id then raise exception 'NOT_POLL_CREATOR'; end if;
  if v_status = 'closed' then return; end if;
  update public.polls set status = 'closed', closed_at = now() where id = p_poll_id;
end;
$$;

create function public.delete_poll(p_actor_id uuid, p_poll_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_trip_id uuid;
  v_created_by uuid;
  v_owner_id uuid;
begin
  select p.trip_id, p.created_by, t.owner_id
    into v_trip_id, v_created_by, v_owner_id
  from public.polls p join public.trips t on t.id = p.trip_id
  where p.id = p_poll_id;
  if not found then raise exception 'POLL_NOT_FOUND'; end if;
  perform private.board_require_member(p_actor_id, v_trip_id, false);
  select created_by into v_created_by from public.polls where id = p_poll_id for update;
  if v_created_by <> p_actor_id and v_owner_id <> p_actor_id then raise exception 'NOT_POLL_CREATOR'; end if;
  delete from public.polls where id = p_poll_id;
end;
$$;

revoke all on function public.create_poll(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.vote_poll(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.remove_poll_vote(uuid, uuid) from public, anon, authenticated;
revoke all on function public.close_poll(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_poll(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_poll(uuid, uuid, text, jsonb), public.vote_poll(uuid, uuid, uuid),
  public.remove_poll_vote(uuid, uuid), public.close_poll(uuid, uuid), public.delete_poll(uuid, uuid) to service_role;

alter publication supabase_realtime add table public.polls;
alter publication supabase_realtime add table public.poll_options;
alter publication supabase_realtime add table public.poll_votes;
