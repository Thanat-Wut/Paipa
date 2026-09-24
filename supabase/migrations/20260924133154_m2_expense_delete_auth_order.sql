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

  select exists (
    select 1 from public.trip_members m
    where m.trip_id = p_trip_id and m.user_id = p_actor_id
  ) into v_is_member;
  if p_actor_id is null or (p_actor_id <> v_owner_id and not v_is_member) then
    raise exception using errcode = 'P0001', message = 'EXPENSE_FORBIDDEN';
  end if;

  select e.* into v_expense
  from public.expenses e
  where e.trip_id = p_trip_id and e.id = p_expense_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'EXPENSE_NOT_FOUND';
  end if;

  if p_actor_id <> v_owner_id and (
    v_expense.created_by <> p_actor_id
    or v_expense.paid_by is distinct from p_actor_id
    or v_expense.payment_source is distinct from 'personal'
  ) then
    raise exception using errcode = 'P0001', message = 'EXPENSE_FORBIDDEN';
  end if;
  if v_trip_status = 'archived' then
    raise exception using errcode = 'P0001', message = 'TRIP_ARCHIVED';
  end if;
  if v_expense.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'EXPENSE_ALREADY_DELETED';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 1 or char_length(btrim(p_reason)) > 500 then
    raise exception using errcode = 'P0001', message = 'VALIDATION_ERROR';
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

revoke all on function public.delete_expense(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.delete_expense(uuid, uuid, uuid, text)
  to service_role;
