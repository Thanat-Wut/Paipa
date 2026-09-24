-- M2.7: derive spent and available in the same summary statement as payments.
create or replace function public.get_trip_money_summary(
  p_actor_id uuid,
  p_trip_id uuid
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with authorized_trip as (
    select t.id, t.owner_id, t.currency, t.budget_per_person
    from public.trips t
    where t.id = p_trip_id
      and exists (
        select 1 from public.profiles p
        where p.id = p_actor_id
      )
      and (
        t.owner_id = p_actor_id
        or exists (
          select 1 from public.trip_members m
          where m.trip_id = t.id and m.user_id = p_actor_id
        )
      )
  ),
  expectation as (
    select
      coalesce(sum(t.budget_per_person) filter (where m.user_id is not null), 0::numeric) as expected,
      count(m.user_id)::integer as going_count
    from authorized_trip t
    left join public.trip_members m
      on m.trip_id = t.id and m.attendance = 'going'
    group by t.id
  ),
  payment_totals as (
    select
      coalesce(sum(ps.amount) filter (where ps.status = 'pending'), 0::numeric) as pending,
      coalesce(sum(ps.amount) filter (where ps.status = 'verified'), 0::numeric) as collected
    from authorized_trip t
    left join public.payment_submissions ps on ps.trip_id = t.id
  ),
  expense_totals as (
    select
      coalesce(sum(e.amount) filter (
        where e.payment_source = 'trip_fund' and e.deleted_at is null
      ), 0::numeric) as spent
    from authorized_trip t
    left join public.expenses e on e.trip_id = t.id
  )
  select jsonb_build_object(
    'currency', t.currency,
    'budgetPerPerson', t.budget_per_person::text,
    'expected', round(e.expected, 2)::text,
    'pending', round(m.pending, 2)::text,
    'collected', round(m.collected, 2)::text,
    'spent', round(x.spent, 2)::text,
    'available', round(m.collected - x.spent, 2)::text,
    'goingCount', e.going_count
  )
  from authorized_trip t
  cross join expectation e
  cross join payment_totals m
  cross join expense_totals x;
$$;

revoke all on function public.get_trip_money_summary(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_trip_money_summary(uuid, uuid) to service_role;
