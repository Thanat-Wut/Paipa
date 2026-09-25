-- M4.3 Trip Activity: small historical summaries recorded at trusted mutation boundaries.

create table public.trip_activities (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null check (type in (
    'board_note_created', 'board_comment_created', 'poll_created', 'poll_closed',
    'plan_item_created', 'plan_item_updated', 'plan_item_deleted',
    'payment_verified', 'expense_created'
  )),
  entity_type text not null check (entity_type in ('board_note', 'board_comment', 'poll', 'plan_item', 'payment', 'expense')),
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now()
);

create index trip_activities_trip_created_idx
  on public.trip_activities(trip_id, created_at desc, id desc);
create index trip_activities_actor_idx on public.trip_activities(actor_id);

alter table public.trip_activities enable row level security;
revoke all on table public.trip_activities from public, anon, authenticated;
grant select on table public.trip_activities to service_role;

create function private.record_trip_activity(
  p_trip_id uuid,
  p_actor_id uuid,
  p_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activity_id uuid;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(p_payload) as key
       where key not in ('title', 'itemTitle', 'dayDate', 'noteTitle')
     ) then
    raise exception 'ACTIVITY_INVALID_PAYLOAD';
  end if;
  insert into public.trip_activities(trip_id, actor_id, type, entity_type, entity_id, payload)
  values (p_trip_id, p_actor_id, p_type, p_entity_type, p_entity_id, p_payload)
  returning id into v_activity_id;
  return v_activity_id;
end;
$$;

create function public.create_board_note_with_activity(
  p_actor_id uuid, p_trip_id uuid, p_title text, p_content text, p_color text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_note_id uuid;
  v_title text;
begin
  v_note_id := public.create_board_note(p_actor_id, p_trip_id, p_title, p_content, p_color);
  select title into v_title from public.board_notes where id = v_note_id;
  perform private.record_trip_activity(p_trip_id, p_actor_id, 'board_note_created', 'board_note', v_note_id, jsonb_build_object('title', v_title));
  return v_note_id;
end;
$$;

create function public.create_board_comment_with_activity(
  p_actor_id uuid, p_note_id uuid, p_content text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_comment_id uuid;
  v_trip_id uuid;
  v_note_title text;
begin
  select n.trip_id, n.title into v_trip_id, v_note_title from public.board_notes n where n.id = p_note_id;
  if not found then raise exception 'NOTE_NOT_FOUND'; end if;
  v_comment_id := public.create_board_note_comment(p_actor_id, p_note_id, p_content);
  perform private.record_trip_activity(v_trip_id, p_actor_id, 'board_comment_created', 'board_comment', v_comment_id, jsonb_build_object('noteTitle', v_note_title));
  return v_comment_id;
end;
$$;

create function public.create_poll_with_activity(
  p_actor_id uuid, p_trip_id uuid, p_question text, p_options jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_poll_id uuid;
  v_question text;
begin
  v_poll_id := public.create_poll(p_actor_id, p_trip_id, p_question, p_options);
  select question into v_question from public.polls where id = v_poll_id;
  perform private.record_trip_activity(p_trip_id, p_actor_id, 'poll_created', 'poll', v_poll_id, jsonb_build_object('title', v_question));
  return v_poll_id;
end;
$$;

create function public.close_poll_with_activity(
  p_actor_id uuid, p_poll_id uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_trip_id uuid;
  v_status text;
  v_question text;
begin
  select trip_id, status, question into v_trip_id, v_status, v_question
  from public.polls where id = p_poll_id for update;
  if not found then raise exception 'POLL_NOT_FOUND'; end if;
  perform public.close_poll(p_actor_id, p_poll_id);
  if v_status = 'open' then
    perform private.record_trip_activity(v_trip_id, p_actor_id, 'poll_closed', 'poll', p_poll_id, jsonb_build_object('title', v_question));
  end if;
end;
$$;

create function public.create_plan_item_with_activity(
  p_actor_id uuid, p_trip_id uuid, p_day_date date, p_start_time time,
  p_title text, p_description text, p_location_text text,
  p_board_note_id uuid, p_poll_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_item_id uuid;
  v_title text;
begin
  v_item_id := public.create_plan_item(p_actor_id, p_trip_id, p_day_date, p_start_time, p_title, p_description, p_location_text, p_board_note_id, p_poll_id);
  select title into v_title from public.trip_plan_items where id = v_item_id;
  perform private.record_trip_activity(p_trip_id, p_actor_id, 'plan_item_created', 'plan_item', v_item_id, jsonb_build_object('itemTitle', v_title, 'dayDate', p_day_date::text));
  return v_item_id;
end;
$$;

create function public.update_plan_item_with_activity(
  p_actor_id uuid, p_item_id uuid, p_day_date date, p_start_time time,
  p_title text, p_description text, p_location_text text,
  p_board_note_id uuid, p_poll_id uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_trip_id uuid;
  v_title text;
begin
  select trip_id into v_trip_id from public.trip_plan_items where id = p_item_id for update;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  perform public.update_plan_item(p_actor_id, p_item_id, p_day_date, p_start_time, p_title, p_description, p_location_text, p_board_note_id, p_poll_id);
  select title into v_title from public.trip_plan_items where id = p_item_id;
  perform private.record_trip_activity(v_trip_id, p_actor_id, 'plan_item_updated', 'plan_item', p_item_id, jsonb_build_object('itemTitle', v_title, 'dayDate', p_day_date::text));
end;
$$;

create function public.delete_plan_item_with_activity(
  p_actor_id uuid, p_item_id uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_trip_id uuid;
  v_title text;
begin
  select trip_id, title into v_trip_id, v_title from public.trip_plan_items where id = p_item_id for update;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  perform public.delete_plan_item(p_actor_id, p_item_id);
  perform private.record_trip_activity(v_trip_id, p_actor_id, 'plan_item_deleted', 'plan_item', p_item_id, jsonb_build_object('itemTitle', v_title));
end;
$$;

create function public.verify_payment_with_activity(
  p_actor_id uuid, p_trip_id uuid, p_submission_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_submission_id uuid;
begin
  v_submission_id := public.verify_payment(p_actor_id, p_trip_id, p_submission_id);
  perform private.record_trip_activity(p_trip_id, p_actor_id, 'payment_verified', 'payment', v_submission_id, '{}'::jsonb);
  return v_submission_id;
end;
$$;

create function public.create_expense_with_activity(
  p_actor_id uuid, p_trip_id uuid, p_expense_id uuid, p_client_request_id uuid,
  p_request_hash text, p_title text, p_amount numeric, p_category text,
  p_payment_source text, p_paid_by uuid, p_spent_at timestamptz,
  p_description text, p_receipt_path text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_expense_id uuid;
begin
  v_result := public.create_expense(p_actor_id, p_trip_id, p_expense_id, p_client_request_id, p_request_hash, p_title, p_amount, p_category, p_payment_source, p_paid_by, p_spent_at, p_description, p_receipt_path);
  if coalesce((v_result->>'replayed')::boolean, false) = false then
    v_expense_id := (v_result->'expense'->>'id')::uuid;
    perform private.record_trip_activity(p_trip_id, p_actor_id, 'expense_created', 'expense', v_expense_id, jsonb_build_object('title', v_result->'expense'->>'title'));
  end if;
  return v_result;
end;
$$;

revoke all on function private.record_trip_activity(uuid, uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.create_board_note_with_activity(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.create_board_comment_with_activity(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.create_poll_with_activity(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.close_poll_with_activity(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_plan_item_with_activity(uuid, uuid, date, time, text, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.update_plan_item_with_activity(uuid, uuid, date, time, text, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_plan_item_with_activity(uuid, uuid) from public, anon, authenticated;
revoke all on function public.verify_payment_with_activity(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_expense_with_activity(uuid, uuid, uuid, uuid, text, text, numeric, text, text, uuid, timestamptz, text, text) from public, anon, authenticated;

grant execute on function public.create_board_note_with_activity(uuid, uuid, text, text, text),
  public.create_board_comment_with_activity(uuid, uuid, text),
  public.create_poll_with_activity(uuid, uuid, text, jsonb),
  public.close_poll_with_activity(uuid, uuid),
  public.create_plan_item_with_activity(uuid, uuid, date, time, text, text, text, uuid, uuid),
  public.update_plan_item_with_activity(uuid, uuid, date, time, text, text, text, uuid, uuid),
  public.delete_plan_item_with_activity(uuid, uuid),
  public.verify_payment_with_activity(uuid, uuid, uuid),
  public.create_expense_with_activity(uuid, uuid, uuid, uuid, text, text, numeric, text, text, uuid, timestamptz, text, text)
  to service_role;

alter publication supabase_realtime add table public.trip_activities;
