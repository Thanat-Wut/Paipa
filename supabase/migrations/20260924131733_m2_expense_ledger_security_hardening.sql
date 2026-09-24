-- M2.6 security hardening: keep the ledger mutable only through audited RPCs.
revoke insert, update, delete on table public.expenses from service_role;
grant select on table public.expenses to service_role;

create or replace function public.create_expense(
  p_actor_id uuid,
  p_trip_id uuid,
  p_expense_id uuid,
  p_client_request_id uuid,
  p_request_hash text,
  p_title text,
  p_amount numeric,
  p_category text,
  p_payment_source text,
  p_paid_by uuid,
  p_spent_at timestamptz,
  p_description text,
  p_receipt_path text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner_id uuid;
  v_trip_status text;
  v_is_member boolean;
  v_existing public.expenses%rowtype;
  v_expense public.expenses%rowtype;
begin
  select t.owner_id, t.status into v_owner_id, v_trip_status
  from public.trips t
  where t.id = p_trip_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'TRIP_NOT_FOUND';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_actor_id) then
    raise exception using errcode = 'P0001', message = 'IDENTITY_REQUIRED';
  end if;

  select exists (
    select 1 from public.trip_members m
    where m.trip_id = p_trip_id and m.user_id = p_actor_id
  ) into v_is_member;
  if p_actor_id <> v_owner_id and not v_is_member then
    raise exception using errcode = 'P0001', message = 'EXPENSE_FORBIDDEN';
  end if;

  select e.* into v_existing
  from public.expenses e
  where e.trip_id = p_trip_id
    and e.created_by = p_actor_id
    and e.client_request_id = p_client_request_id;
  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    if p_actor_id <> v_owner_id and v_existing.deleted_at is not null then
      raise exception using errcode = 'P0001', message = 'EXPENSE_FORBIDDEN';
    end if;
    return jsonb_build_object('expense', to_jsonb(v_existing), 'replayed', true);
  end if;
  if v_trip_status = 'archived' then
    raise exception using errcode = 'P0001', message = 'TRIP_ARCHIVED';
  end if;
  if p_payment_source not in ('trip_fund', 'personal')
     or (p_payment_source = 'trip_fund' and p_paid_by is not null)
     or (p_payment_source = 'personal' and p_paid_by is null) then
    raise exception using errcode = 'P0001', message = 'VALIDATION_ERROR';
  end if;
  if p_payment_source = 'personal' and not exists (
    select 1 from public.trip_members m
    where m.trip_id = p_trip_id and m.user_id = p_paid_by
  ) then
    raise exception using errcode = 'P0001', message = 'EXPENSE_PAYER_NOT_MEMBER';
  end if;
  if p_actor_id <> v_owner_id
     and (not v_is_member or p_payment_source <> 'personal' or p_paid_by <> p_actor_id) then
    raise exception using errcode = 'P0001', message = 'EXPENSE_FORBIDDEN';
  end if;
  if p_receipt_path is not null
     and lower(p_receipt_path) !~ (
       '^' || p_trip_id::text || '/' || p_expense_id::text
       || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp|pdf)$'
     ) then
    raise exception using errcode = 'P0001', message = 'VALIDATION_ERROR';
  end if;

  insert into public.expenses (
    id, trip_id, title, amount, category, payment_source, paid_by, created_by,
    spent_at, description, receipt_path, client_request_id, request_hash
  ) values (
    p_expense_id, p_trip_id, p_title, p_amount, p_category, p_payment_source, p_paid_by, p_actor_id,
    p_spent_at, p_description, p_receipt_path, p_client_request_id, p_request_hash
  )
  on conflict (trip_id, created_by, client_request_id) do nothing
  returning * into v_expense;

  if found then
    return jsonb_build_object('expense', to_jsonb(v_expense), 'replayed', false);
  end if;

  select e.* into v_existing
  from public.expenses e
  where e.trip_id = p_trip_id
    and e.created_by = p_actor_id
    and e.client_request_id = p_client_request_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'EXPENSE_CREATE_FAILED';
  end if;
  if v_existing.request_hash <> p_request_hash then
    raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
  end if;
  if p_actor_id <> v_owner_id and v_existing.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'EXPENSE_FORBIDDEN';
  end if;
  return jsonb_build_object('expense', to_jsonb(v_existing), 'replayed', true);
end;
$function$;

create or replace function public.replace_expense(
  p_actor_id uuid,
  p_trip_id uuid,
  p_expense_id uuid,
  p_expected_updated_at timestamptz,
  p_new_expense_id uuid,
  p_client_request_id uuid,
  p_request_hash text,
  p_title text,
  p_amount numeric,
  p_category text,
  p_payment_source text,
  p_paid_by uuid,
  p_spent_at timestamptz,
  p_description text,
  p_receipt_path text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner_id uuid;
  v_trip_status text;
  v_is_member boolean;
  v_original public.expenses%rowtype;
  v_existing public.expenses%rowtype;
  v_replacement public.expenses%rowtype;
begin
  select t.owner_id, t.status into v_owner_id, v_trip_status
  from public.trips t
  where t.id = p_trip_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'EXPENSE_NOT_FOUND';
  end if;

  select e.* into v_original
  from public.expenses e
  where e.trip_id = p_trip_id and e.id = p_expense_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'EXPENSE_NOT_FOUND';
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_actor_id) then
    raise exception using errcode = 'P0001', message = 'IDENTITY_REQUIRED';
  end if;
  select exists (
    select 1 from public.trip_members m
    where m.trip_id = p_trip_id and m.user_id = p_actor_id
  ) into v_is_member;
  if p_actor_id <> v_owner_id and not v_is_member then
    raise exception using errcode = 'P0001', message = 'EXPENSE_FORBIDDEN';
  end if;

  select e.* into v_existing
  from public.expenses e
  where e.trip_id = p_trip_id
    and e.created_by = p_actor_id
    and e.client_request_id = p_client_request_id;
  if found then
    if v_existing.request_hash <> p_request_hash
       or v_existing.replaces_expense_id is distinct from p_expense_id then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    if p_actor_id <> v_owner_id and v_existing.deleted_at is not null then
      raise exception using errcode = 'P0001', message = 'EXPENSE_FORBIDDEN';
    end if;
    return jsonb_build_object('expense', to_jsonb(v_existing), 'replayed', true);
  end if;

  if v_trip_status = 'archived' then
    raise exception using errcode = 'P0001', message = 'TRIP_ARCHIVED';
  end if;
  if v_original.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'EXPENSE_CONFLICT';
  end if;
  if v_original.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'EXPENSE_CONFLICT';
  end if;
  if exists (
    select 1 from public.expenses e where e.trip_id = p_trip_id and e.replaces_expense_id = p_expense_id
  ) then
    raise exception using errcode = 'P0001', message = 'EXPENSE_CONFLICT';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 1 or char_length(btrim(p_reason)) > 500 then
    raise exception using errcode = 'P0001', message = 'VALIDATION_ERROR';
  end if;
  if p_payment_source not in ('trip_fund', 'personal')
     or (p_payment_source = 'trip_fund' and p_paid_by is not null)
     or (p_payment_source = 'personal' and p_paid_by is null) then
    raise exception using errcode = 'P0001', message = 'VALIDATION_ERROR';
  end if;
  if p_payment_source = 'personal' and not exists (
    select 1 from public.trip_members m
    where m.trip_id = p_trip_id and m.user_id = p_paid_by
  ) then
    raise exception using errcode = 'P0001', message = 'EXPENSE_PAYER_NOT_MEMBER';
  end if;

  if p_actor_id <> v_owner_id and (
    not v_is_member
    or v_original.created_by <> p_actor_id
    or v_original.paid_by <> p_actor_id
    or v_original.payment_source <> 'personal'
    or p_payment_source <> 'personal'
    or p_paid_by <> p_actor_id
  ) then
    raise exception using errcode = 'P0001', message = 'EXPENSE_FORBIDDEN';
  end if;
  if p_receipt_path is not null
     and lower(p_receipt_path) !~ (
       '^' || p_trip_id::text || '/' || p_new_expense_id::text
       || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp|pdf)$'
     ) then
    raise exception using errcode = 'P0001', message = 'VALIDATION_ERROR';
  end if;

  update public.expenses
  set deleted_at = clock_timestamp(),
      deleted_by = p_actor_id,
      delete_reason = btrim(p_reason)
  where id = p_expense_id and trip_id = p_trip_id and deleted_at is null;

  insert into public.expenses (
    id, trip_id, title, amount, category, payment_source, paid_by, created_by,
    spent_at, description, receipt_path, replaces_expense_id, client_request_id, request_hash
  ) values (
    p_new_expense_id, p_trip_id, p_title, p_amount, p_category, p_payment_source, p_paid_by, p_actor_id,
    p_spent_at, p_description, p_receipt_path, p_expense_id, p_client_request_id, p_request_hash
  )
  returning * into v_replacement;

  return jsonb_build_object('expense', to_jsonb(v_replacement), 'replayed', false);
end;
$function$;

create or replace function public.delete_expense(
  p_actor_id uuid,
  p_trip_id uuid,
  p_expense_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner_id uuid;
  v_trip_status text;
  v_is_member boolean;
  v_expense public.expenses%rowtype;
begin
  select t.owner_id, t.status into v_owner_id, v_trip_status
  from public.trips t
  where t.id = p_trip_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'EXPENSE_NOT_FOUND';
  end if;
  if v_trip_status = 'archived' then
    raise exception using errcode = 'P0001', message = 'TRIP_ARCHIVED';
  end if;

  select e.* into v_expense
  from public.expenses e
  where e.trip_id = p_trip_id and e.id = p_expense_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'EXPENSE_NOT_FOUND';
  end if;
  if v_expense.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'EXPENSE_ALREADY_DELETED';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 1 or char_length(btrim(p_reason)) > 500 then
    raise exception using errcode = 'P0001', message = 'VALIDATION_ERROR';
  end if;

  select exists (
    select 1 from public.trip_members m
    where m.trip_id = p_trip_id and m.user_id = p_actor_id
  ) into v_is_member;

  if p_actor_id <> v_owner_id and (
    not v_is_member
    or v_expense.created_by <> p_actor_id
    or v_expense.paid_by <> p_actor_id
    or v_expense.payment_source <> 'personal'
  ) then
    raise exception using errcode = 'P0001', message = 'EXPENSE_FORBIDDEN';
  end if;

  update public.expenses
  set deleted_at = clock_timestamp(),
      deleted_by = p_actor_id,
      delete_reason = btrim(p_reason)
  where id = p_expense_id and trip_id = p_trip_id and deleted_at is null
  returning * into v_expense;
  return jsonb_build_object('expense', to_jsonb(v_expense), 'replayed', false);
end;
$function$;

revoke all on function public.create_expense(uuid, uuid, uuid, uuid, text, text, numeric, text, text, uuid, timestamptz, text, text)
  from public, anon, authenticated;
revoke all on function public.replace_expense(uuid, uuid, uuid, timestamptz, uuid, uuid, text, text, numeric, text, text, uuid, timestamptz, text, text, text)
  from public, anon, authenticated;
revoke all on function public.delete_expense(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_expense(uuid, uuid, uuid, uuid, text, text, numeric, text, text, uuid, timestamptz, text, text)
  to service_role;
grant execute on function public.replace_expense(uuid, uuid, uuid, timestamptz, uuid, uuid, text, text, numeric, text, text, uuid, timestamptz, text, text, text)
  to service_role;
grant execute on function public.delete_expense(uuid, uuid, uuid, text)
  to service_role;

create or replace function public.cleanup_m2_expense_e2e_fixture(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner_id uuid;
  v_trip_name text;
  v_deleted integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'TEST_FIXTURE_CLEANUP_FORBIDDEN';
  end if;

  select t.owner_id, t.name into v_owner_id, v_trip_name
  from public.trips t
  where t.id = p_trip_id
  for update;
  if not found or v_trip_name is distinct from 'M2.6 expense ledger E2E'
     or not exists (
       select 1 from public.profiles p
       where p.id = v_owner_id and p.display_name = 'M2.6 E2E Owner'
     ) then
    raise exception using errcode = 'P0001', message = 'TEST_FIXTURE_NOT_FOUND';
  end if;
  if exists (
    select 1 from public.trip_members m
    left join public.profiles p on p.id = m.user_id
    where m.trip_id = p_trip_id and p.display_name not like 'M2.6 E2E %'
  ) or exists (
    select 1 from public.expenses e
    left join public.profiles c on c.id = e.created_by
    left join public.profiles p on p.id = e.paid_by
    left join public.profiles d on d.id = e.deleted_by
    where e.trip_id = p_trip_id and (
      c.display_name not like 'M2.6 E2E %'
      or (e.paid_by is not null and p.display_name not like 'M2.6 E2E %')
      or (e.deleted_by is not null and d.display_name not like 'M2.6 E2E %')
    )
  ) then
    raise exception using errcode = 'P0001', message = 'TEST_FIXTURE_CONTAINS_NON_TEST_DATA';
  end if;
  if exists (
    select 1 from storage.objects o
    where o.bucket_id = 'expense-receipts' and o.name like p_trip_id::text || '/%'
  ) then
    raise exception using errcode = 'P0001', message = 'TEST_RECEIPT_OBJECTS_REMAIN';
  end if;

  loop
    delete from public.expenses e
    where e.trip_id = p_trip_id
      and not exists (
        select 1 from public.expenses child
        where child.trip_id = p_trip_id and child.replaces_expense_id = e.id
      );
    get diagnostics v_deleted = row_count;
    exit when v_deleted = 0;
  end loop;
  if exists (select 1 from public.expenses e where e.trip_id = p_trip_id) then
    raise exception using errcode = 'P0001', message = 'TEST_FIXTURE_EXPENSE_CYCLE';
  end if;
end;
$function$;
revoke all on function public.cleanup_m2_expense_e2e_fixture(uuid) from public, anon, authenticated;
grant execute on function public.cleanup_m2_expense_e2e_fixture(uuid) to service_role;
