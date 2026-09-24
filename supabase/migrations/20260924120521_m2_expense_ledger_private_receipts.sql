-- M2.6 additive expense ledger and private receipt storage.
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete restrict,
  title text not null,
  amount numeric(12,2) not null,
  category text not null,
  payment_source text not null,
  paid_by uuid null references public.profiles(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  spent_at timestamptz not null,
  description text not null default '',
  receipt_path text null,
  replaces_expense_id uuid null,
  deleted_at timestamptz null,
  deleted_by uuid null references public.profiles(id) on delete restrict,
  delete_reason text null,
  client_request_id uuid not null,
  request_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint expenses_title_check
    check (title = btrim(title) and char_length(title) between 1 and 120),
  constraint expenses_amount_check
    check (amount > 0 and amount <= 100000000 and amount <> 'NaN'::numeric),
  constraint expenses_category_check
    check (category in ('transport', 'accommodation', 'food', 'activity', 'shopping', 'member_refund', 'other')),
  constraint expenses_payment_source_check
    check (
      (payment_source = 'trip_fund' and paid_by is null)
      or (payment_source = 'personal' and paid_by is not null)
    ),
  constraint expenses_payment_source_value_check
    check (payment_source in ('trip_fund', 'personal')),
  constraint expenses_description_check
    check (char_length(description) <= 2000),
  constraint expenses_delete_audit_check
    check (
      (deleted_at is null and deleted_by is null and delete_reason is null)
      or (
        deleted_at is not null and deleted_by is not null
        and delete_reason is not null and char_length(delete_reason) between 1 and 500
      )
    ),
  constraint expenses_request_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint expenses_receipt_path_check
    check (
      receipt_path is null
      or receipt_path ~ ('^' || trip_id::text || '/' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp|pdf)$')
    ),
  constraint expenses_trip_id_id_key unique (trip_id, id),
  constraint expenses_replaces_same_trip_fkey
    foreign key (trip_id, replaces_expense_id)
    references public.expenses(trip_id, id) on delete restrict,
  constraint expenses_not_self_replacement_check
    check (replaces_expense_id is null or replaces_expense_id <> id),
  constraint expenses_idempotency_key_key
    unique (trip_id, created_by, client_request_id)
);

create unique index expenses_one_child_per_parent_uidx
  on public.expenses (trip_id, replaces_expense_id)
  where replaces_expense_id is not null;

create index expenses_trip_spent_at_idx
  on public.expenses (trip_id, spent_at desc, created_at desc);

alter table public.expenses enable row level security;
revoke all on table public.expenses from public, anon, authenticated;
grant select, insert, update, delete on table public.expenses to service_role;

create or replace function public.set_expense_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$function$;

revoke all on function public.set_expense_updated_at() from public, anon, authenticated;
grant execute on function public.set_expense_updated_at() to service_role;

create trigger expenses_updated_at
before update on public.expenses
for each row execute function public.set_expense_updated_at();

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) values (
  'expense-receipts',
  'expense-receipts',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

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
security invoker
set search_path = ''
as $function$
declare
  v_owner_id uuid;
  v_trip_status text;
  v_is_member boolean;
  v_existing public.expenses%rowtype;
  v_expense public.expenses%rowtype;
begin
  select e.* into v_existing
  from public.expenses e
  where e.trip_id = p_trip_id
    and e.created_by = p_actor_id
    and e.client_request_id = p_client_request_id;
  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('expense', to_jsonb(v_existing), 'replayed', true);
  end if;

  select t.owner_id, t.status into v_owner_id, v_trip_status
  from public.trips t
  where t.id = p_trip_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'TRIP_NOT_FOUND';
  end if;
  if v_trip_status = 'archived' then
    raise exception using errcode = 'P0001', message = 'TRIP_ARCHIVED';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_actor_id) then
    raise exception using errcode = 'P0001', message = 'IDENTITY_REQUIRED';
  end if;

  select exists (
    select 1 from public.trip_members m
    where m.trip_id = p_trip_id and m.user_id = p_actor_id
  ) into v_is_member;

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
security invoker
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

  select exists (
    select 1 from public.trip_members m
    where m.trip_id = p_trip_id and m.user_id = p_actor_id
  ) into v_is_member;

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
security invoker
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

create or replace function public.delete_trip(p_actor_id uuid, p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform 1
  from public.trips t
  where t.id = p_trip_id and t.owner_id = p_actor_id
  for update;
  if not found then
    raise exception 'Trip owner required';
  end if;
  if exists (
    select 1 from public.expenses e where e.trip_id = p_trip_id
  ) then
    raise exception using errcode = 'P0001', message = 'TRIP_HAS_EXPENSE_HISTORY';
  end if;
  delete from public.trips where id = p_trip_id and owner_id = p_actor_id;
end;
$function$;

revoke all on function public.delete_trip(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_trip(uuid, uuid) to service_role;
