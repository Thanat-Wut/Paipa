-- M2.4: atomic owner review and database-enforced resubmission invariants.
-- Keep previously applied M2.1-M2.3 migrations immutable.

alter table public.payment_submissions
  add constraint payment_submissions_rejection_reason_length_check
  check (
    rejection_reason is null
    or (
      char_length(rejection_reason) <= 500
      and rejection_reason ~ '[^[:space:]]'
    )
  );

create function public.verify_payment(
  p_actor_id uuid,
  p_trip_id uuid,
  p_submission_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_status text;
  v_submission_id uuid;
begin
  if p_actor_id is null or not exists (
    select 1 from public.profiles where id = p_actor_id
  ) then
    raise exception using errcode = 'P0002', message = 'IDENTITY_NOT_FOUND';
  end if;

  select owner_id into v_owner_id
  from public.trips
  where id = p_trip_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'TRIP_NOT_FOUND';
  end if;
  if v_owner_id <> p_actor_id then
    raise exception using errcode = '42501', message = 'NOT_OWNER';
  end if;

  update public.payment_submissions
  set status = 'verified',
      verified_by = p_actor_id,
      verified_at = clock_timestamp(),
      rejected_by = null,
      rejected_at = null,
      rejection_reason = null,
      updated_at = clock_timestamp()
  where id = p_submission_id
    and trip_id = p_trip_id
    and status = 'pending'
  returning id into v_submission_id;

  if found then return v_submission_id; end if;

  select status into v_status
  from public.payment_submissions
  where id = p_submission_id and trip_id = p_trip_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'PAYMENT_NOT_FOUND';
  end if;

  raise exception using errcode = 'P0001', message = 'PAYMENT_ALREADY_REVIEWED';
end;
$$;

create function public.reject_payment(
  p_actor_id uuid,
  p_trip_id uuid,
  p_submission_id uuid,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_status text;
  v_reason text := regexp_replace(coalesce(p_reason, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_submission_id uuid;
begin
  if p_actor_id is null or not exists (
    select 1 from public.profiles where id = p_actor_id
  ) then
    raise exception using errcode = 'P0002', message = 'IDENTITY_NOT_FOUND';
  end if;

  select owner_id into v_owner_id
  from public.trips
  where id = p_trip_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'TRIP_NOT_FOUND';
  end if;
  if v_owner_id <> p_actor_id then
    raise exception using errcode = '42501', message = 'NOT_OWNER';
  end if;
  if char_length(v_reason) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  update public.payment_submissions
  set status = 'rejected',
      verified_by = null,
      verified_at = null,
      rejected_by = p_actor_id,
      rejected_at = clock_timestamp(),
      rejection_reason = v_reason,
      updated_at = clock_timestamp()
  where id = p_submission_id
    and trip_id = p_trip_id
    and status = 'pending'
  returning id into v_submission_id;

  if found then return v_submission_id; end if;

  select status into v_status
  from public.payment_submissions
  where id = p_submission_id and trip_id = p_trip_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'PAYMENT_NOT_FOUND';
  end if;

  raise exception using errcode = 'P0001', message = 'PAYMENT_ALREADY_REVIEWED';
end;
$$;

create function private.enforce_payment_review_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('verified', 'rejected') then
    if new is distinct from old then
      raise exception using errcode = 'P0001', message = 'PAYMENT_SUBMISSION_IMMUTABLE';
    end if;
    return new;
  end if;

  if row(
    new.id, new.trip_id, new.contributor_id, new.client_request_id,
    new.request_hash, new.amount, new.payment_method, new.payment_occurred_at,
    new.proof_path, new.note, new.resubmission_of, new.created_at
  ) is distinct from row(
    old.id, old.trip_id, old.contributor_id, old.client_request_id,
    old.request_hash, old.amount, old.payment_method, old.payment_occurred_at,
    old.proof_path, old.note, old.resubmission_of, old.created_at
  ) then
    raise exception using errcode = 'P0001', message = 'PAYMENT_SUBMISSION_IMMUTABLE';
  end if;

  if new.status not in ('verified', 'rejected') then
    raise exception using errcode = 'P0001', message = 'PAYMENT_REVIEW_TRANSITION_INVALID';
  end if;
  return new;
end;
$$;

create trigger payment_submissions_review_transition_guard
before update on public.payment_submissions
for each row execute function private.enforce_payment_review_transition();

create function private.validate_payment_resubmission_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_status text;
  v_trip_status text;
begin
  if new.resubmission_of is null then return new; end if;

  select status into v_parent_status
  from public.payment_submissions
  where id = new.resubmission_of
    and trip_id = new.trip_id
    and contributor_id = new.contributor_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'RESUBMISSION_PARENT_NOT_FOUND';
  end if;
  if v_parent_status <> 'rejected' then
    raise exception using errcode = '23514', message = 'RESUBMISSION_PARENT_NOT_REJECTED';
  end if;

  select status into v_trip_status
  from public.trips
  where id = new.trip_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'TRIP_NOT_FOUND';
  end if;
  if v_trip_status = 'archived' then
    raise exception using errcode = '55000', message = 'RESUBMISSION_TRIP_ARCHIVED';
  end if;

  perform 1
  from public.trip_members
  where trip_id = new.trip_id and user_id = new.contributor_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'RESUBMISSION_MEMBER_REQUIRED';
  end if;

  return new;
end;
$$;

create trigger payment_submissions_resubmission_parent_guard
before insert on public.payment_submissions
for each row execute function private.validate_payment_resubmission_parent();

revoke all on function public.verify_payment(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.reject_payment(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.verify_payment(uuid, uuid, uuid) to service_role;
grant execute on function public.reject_payment(uuid, uuid, uuid, text) to service_role;

revoke all on function private.enforce_payment_review_transition() from public, anon, authenticated, service_role;
revoke all on function private.validate_payment_resubmission_parent() from public, anon, authenticated, service_role;
