-- M2.7 money summary acceptance. All fixture rows are transaction scoped.
begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_former uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_trip uuid := gen_random_uuid();
  v_empty uuid := gen_random_uuid();
  v_decimal uuid := gen_random_uuid();
  v_parent uuid := gen_random_uuid();
  v_summary jsonb;
begin
  insert into public.profiles(id, display_name) values
    (v_owner, 'M2.7 Owner'), (v_member, 'M2.7 Member'),
    (v_former, 'M2.7 Former'), (v_outsider, 'M2.7 Outsider');

  insert into public.trips(id, owner_id, name, start_date, end_date, budget_per_person)
  values (v_trip, v_owner, 'M2.7 Fund', '2026-11-01', '2026-11-02', 50),
         (v_empty, v_owner, 'M2.7 Empty', '2026-11-03', '2026-11-04', 25),
         (v_decimal, v_owner, 'M2.7 Decimal', '2026-11-05', '2026-11-06', 1);

  insert into public.trip_members(trip_id, user_id, display_name, role, attendance, signature_path, commitment_signed_at)
  values
    (v_trip, v_owner, 'M2.7 Owner', 'owner', 'going', v_owner::text || '/main.png', now()),
    (v_trip, v_member, 'M2.7 Member', 'member', 'going', v_member::text || '/main.png', now()),
    (v_trip, v_former, 'M2.7 Former', 'member', 'maybe', null, null),
    (v_empty, v_owner, 'M2.7 Owner', 'owner', 'maybe', null, null),
    (v_decimal, v_owner, 'M2.7 Owner', 'owner', 'maybe', null, null);

  insert into public.contributions(trip_id, contributor_id)
  values (v_trip, v_owner), (v_trip, v_member), (v_trip, v_former), (v_decimal, v_owner);

  -- Zero has the full legacy contract plus both new decimal strings.
  execute 'set local role service_role';
  v_summary := public.get_trip_money_summary(v_owner, v_empty);
  if v_summary is distinct from jsonb_build_object(
    'currency', 'THB', 'budgetPerPerson', '25.00', 'expected', '0.00',
    'pending', '0.00', 'collected', '0.00', 'goingCount', 0,
    'spent', '0.00', 'available', '0.00'
  ) then raise exception 'empty summary mismatch: %', v_summary; end if;
  execute 'reset role';

  insert into public.payment_submissions(
    trip_id, contributor_id, client_request_id, request_hash, amount,
    payment_method, payment_occurred_at, status, verified_by, verified_at,
    rejected_by, rejected_at, rejection_reason
  ) values
    (v_trip, v_member, gen_random_uuid(), repeat('a',64), 20, 'cash', now(), 'verified', v_owner, now(), null, null, null),
    (v_trip, v_member, gen_random_uuid(), repeat('b',64), 3, 'cash', now(), 'pending', null, null, null, null, null),
    (v_trip, v_member, gen_random_uuid(), repeat('c',64), 7, 'cash', now(), 'rejected', null, null, v_owner, now(), 'Rejected'),
    (v_trip, v_former, gen_random_uuid(), repeat('d',64), 5, 'cash', now(), 'verified', v_owner, now(), null, null, null),
    (v_decimal, v_owner, gen_random_uuid(), repeat('e',64), 0.10, 'cash', now(), 'verified', v_owner, now(), null, null, null),
    (v_decimal, v_owner, gen_random_uuid(), repeat('f',64), 0.20, 'cash', now(), 'verified', v_owner, now(), null, null, null);

  delete from public.trip_members where trip_id = v_trip and user_id = v_former;

  insert into public.expenses(
    id, trip_id, title, amount, category, payment_source, paid_by,
    created_by, spent_at, client_request_id, request_hash, deleted_at, deleted_by,
    delete_reason, replaces_expense_id
  ) values
    (gen_random_uuid(), v_trip, 'Active food', 8, 'food', 'trip_fund', null, v_owner, now(), gen_random_uuid(), repeat('1',64), null, null, null, null),
    (gen_random_uuid(), v_trip, 'Member refund', 2, 'member_refund', 'trip_fund', null, v_owner, now(), gen_random_uuid(), repeat('2',64), null, null, null, null),
    (gen_random_uuid(), v_trip, 'Personal excluded', 100, 'food', 'personal', v_member, v_member, now(), gen_random_uuid(), repeat('3',64), null, null, null, null),
    (gen_random_uuid(), v_trip, 'Deleted excluded', 9, 'food', 'trip_fund', null, v_owner, now(), gen_random_uuid(), repeat('4',64), now(), v_owner, 'Removed', null),
    (v_parent, v_trip, 'Replaced parent', 4, 'food', 'trip_fund', null, v_owner, now(), gen_random_uuid(), repeat('5',64), now(), v_owner, 'Replaced', null),
    (gen_random_uuid(), v_decimal, 'Decimal spend', 0.15, 'food', 'trip_fund', null, v_owner, now(), gen_random_uuid(), repeat('6',64), null, null, null, null);

  insert into public.expenses(
    trip_id, title, amount, category, payment_source, created_by,
    spent_at, client_request_id, request_hash, replaces_expense_id
  ) values (v_trip, 'Replacement child', 6, 'food', 'trip_fund', v_owner,
            now(), gen_random_uuid(), repeat('7',64), v_parent);

  execute 'set local role service_role';
  v_summary := public.get_trip_money_summary(v_owner, v_trip);
  if v_summary is distinct from jsonb_build_object(
    'currency', 'THB', 'budgetPerPerson', '50.00', 'expected', '100.00',
    'pending', '3.00', 'collected', '25.00', 'goingCount', 2,
    'spent', '16.00', 'available', '9.00'
  ) then raise exception 'fund summary mismatch: %', v_summary; end if;

  if public.get_trip_money_summary(v_member, v_trip) is distinct from v_summary then
    raise exception 'current member summary differs from owner';
  end if;
  if public.get_trip_money_summary(v_former, v_trip) is not null
     or public.get_trip_money_summary(v_outsider, v_trip) is not null
     or public.get_trip_money_summary(gen_random_uuid(), v_trip) is not null
     or public.get_trip_money_summary(v_owner, gen_random_uuid()) is not null then
    raise exception 'former, outsider, missing profile, or missing trip was authorized';
  end if;

  v_summary := public.get_trip_money_summary(v_owner, v_decimal);
  if v_summary ->> 'collected' is distinct from '0.30'
     or v_summary ->> 'spent' is distinct from '0.15'
     or v_summary ->> 'available' is distinct from '0.15' then
    raise exception 'exact 0.10 + 0.20 - 0.15 failed: %', v_summary;
  end if;
  execute 'reset role';

  insert into public.expenses(
    trip_id, title, amount, category, payment_source, created_by,
    spent_at, client_request_id, request_hash
  ) values (v_trip, 'Overdraw', 10, 'other', 'trip_fund', v_owner,
            now(), gen_random_uuid(), repeat('8',64));
  execute 'set local role service_role';
  v_summary := public.get_trip_money_summary(v_owner, v_trip);
  if v_summary ->> 'collected' is distinct from '25.00'
     or v_summary ->> 'spent' is distinct from '26.00'
     or v_summary ->> 'available' is distinct from '-1.00' then
    raise exception 'negative available was clamped or misstated: %', v_summary;
  end if;
  execute 'reset role';
end;
$$;

do $$
begin
  if has_function_privilege('anon', 'public.get_trip_money_summary(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.get_trip_money_summary(uuid,uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.get_trip_money_summary(uuid,uuid)', 'execute') then
    raise exception 'money summary grants changed';
  end if;
end;
$$;
rollback;
