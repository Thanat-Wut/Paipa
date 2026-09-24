-- M2.5: derive money reads from the immutable submission ledger, current roster, and trip budget.
-- No aggregate is stored, and all amounts cross the RPC boundary as decimal text.

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
  )
  select jsonb_build_object(
    'currency', t.currency,
    'budgetPerPerson', t.budget_per_person::text,
    'expected', round(e.expected, 2)::text,
    'pending', round(m.pending, 2)::text,
    'collected', round(m.collected, 2)::text,
    'goingCount', e.going_count
  )
  from authorized_trip t
  cross join expectation e
  cross join payment_totals m;
$$;

create or replace function public.get_trip_member_contributions(
  p_actor_id uuid,
  p_trip_id uuid
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with authorized_trip as (
    select t.id, t.owner_id, t.budget_per_person
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
  payment_totals as (
    select
      ps.contributor_id,
      coalesce(sum(ps.amount) filter (where ps.status = 'pending'), 0::numeric) as pending,
      coalesce(sum(ps.amount) filter (where ps.status = 'verified'), 0::numeric) as verified
    from authorized_trip t
    join public.payment_submissions ps on ps.trip_id = t.id
    group by ps.contributor_id
  ),
  candidates as (
    select
      m.user_id as contributor_id,
      m.display_name,
      m.attendance,
      true as is_current_member
    from authorized_trip t
    join public.trip_members m on m.trip_id = t.id

    union all

    select
      c.contributor_id,
      p.display_name,
      null::text as attendance,
      false as is_current_member
    from authorized_trip t
    join public.contributions c on c.trip_id = t.id
    join public.profiles p on p.id = c.contributor_id
    where exists (
      select 1 from public.payment_submissions ps
      where ps.trip_id = t.id and ps.contributor_id = c.contributor_id
    )
      and not exists (
        select 1 from public.trip_members m
        where m.trip_id = t.id and m.user_id = c.contributor_id
      )
  ),
  amounts as (
    select
      t.id as trip_id,
      t.owner_id,
      c.contributor_id,
      c.display_name,
      c.attendance,
      c.is_current_member,
      case
        when c.is_current_member and c.attendance = 'going' then t.budget_per_person
        else 0::numeric
      end as expected,
      coalesce(p.pending, 0::numeric) as pending,
      coalesce(p.verified, 0::numeric) as verified
    from authorized_trip t
    join candidates c on true
    left join payment_totals p on p.contributor_id = c.contributor_id
  ),
  derived as (
    select
      a.*,
      greatest(a.expected - a.verified, 0::numeric) as remaining,
      greatest(a.verified - a.expected, 0::numeric) as overpaid
    from amounts a
  )
  select aggregate.entries
  from authorized_trip t
  cross join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'contributorId', d.contributor_id,
          'displayName', d.display_name,
          'isCurrentMember', d.is_current_member,
          'attendance', d.attendance,
          'expected', round(d.expected, 2)::text,
          'pending', round(d.pending, 2)::text,
          'verified', round(d.verified, 2)::text,
          'remaining', round(d.remaining, 2)::text,
          'overpaid', round(d.overpaid, 2)::text,
          'status', case
            when d.expected = 0 then 'not_due'
            when d.verified >= d.expected then 'paid'
            when d.verified > 0 then 'partial'
            when d.pending > 0 then 'pending'
            else 'unpaid'
          end
        )
        order by d.is_current_member desc, d.display_name, d.contributor_id
      ),
      '[]'::jsonb
    ) as entries
    from derived d
    where d.trip_id = t.id
      and (t.owner_id = p_actor_id or d.contributor_id = p_actor_id)
  ) aggregate;
$$;

revoke all on function public.get_trip_money_summary(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_trip_member_contributions(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_trip_money_summary(uuid, uuid) to service_role;
grant execute on function public.get_trip_member_contributions(uuid, uuid) to service_role;
