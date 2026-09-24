-- M2.5 read-model acceptance tests. Every fixture is rolled back.
begin;
set local role service_role;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_main_member uuid := gen_random_uuid();
  v_main_maybe uuid := gen_random_uuid();
  v_main_not_going uuid := gen_random_uuid();
  v_partial uuid := gen_random_uuid();
  v_paid uuid := gen_random_uuid();
  v_pending uuid := gen_random_uuid();
  v_unpaid uuid := gen_random_uuid();
  v_zero_due uuid := gen_random_uuid();
  v_leaver uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_trip_main uuid := gen_random_uuid();
  v_trip_states uuid := gen_random_uuid();
  v_trip_empty uuid := gen_random_uuid();
  v_payment_main_pending uuid := gen_random_uuid();
  v_payment_main_verified uuid := gen_random_uuid();
  v_payment_main_rejected uuid := gen_random_uuid();
  v_chain_a uuid := gen_random_uuid();
  v_chain_b uuid := gen_random_uuid();
  v_chain_c uuid := gen_random_uuid();
  v_payment_decimal_b uuid := gen_random_uuid();
  v_result jsonb;
  v_summary jsonb;
  v_list jsonb;
  v_entry jsonb;
  v_count integer;
  v_pending_before numeric;
  v_verified_before numeric;
begin
  insert into public.profiles(id, display_name) values
    (v_owner, 'M2.5 Owner'),
    (v_main_member, 'M2.5 Main Member'),
    (v_main_maybe, 'M2.5 Maybe'),
    (v_main_not_going, 'M2.5 Not Going'),
    (v_partial, 'M2.5 Partial'),
    (v_paid, 'M2.5 Paid'),
    (v_pending, 'M2.5 Pending'),
    (v_unpaid, 'M2.5 Unpaid'),
    (v_zero_due, 'M2.5 Zero Due'),
    (v_leaver, 'M2.5 Lifecycle'),
    (v_outsider, 'M2.5 Outsider');

  insert into public.trips(id, owner_id, name, start_date, end_date, budget_per_person, max_members)
  values
    (v_trip_main, v_owner, 'M2.5 3500 scenario', '2026-12-01', '2026-12-02', 3500, 10),
    (v_trip_states, v_owner, 'M2.5 status scenario', '2026-12-03', '2026-12-04', 10, 10),
    (v_trip_empty, v_owner, 'M2.5 empty scenario', '2026-12-05', '2026-12-06', 50, 10);

  insert into public.trip_members(
    trip_id, user_id, display_name, role, attendance, signature_path, commitment_signed_at
  ) values
    (v_trip_main, v_owner, 'M2.5 Owner', 'owner', 'going', v_owner::text || '/main.png', now()),
    (v_trip_main, v_main_member, 'M2.5 Main Member', 'member', 'going', v_main_member::text || '/main.png', now()),
    (v_trip_main, v_main_maybe, 'M2.5 Maybe', 'member', 'maybe', null, null),
    (v_trip_main, v_main_not_going, 'M2.5 Not Going', 'member', 'not_going', null, null),
    (v_trip_states, v_owner, 'M2.5 Owner', 'owner', 'maybe', null, null),
    (v_trip_states, v_partial, 'M2.5 Partial', 'member', 'going', v_partial::text || '/state.png', now()),
    (v_trip_states, v_paid, 'M2.5 Paid', 'member', 'going', v_paid::text || '/state.png', now()),
    (v_trip_states, v_pending, 'M2.5 Pending', 'member', 'going', v_pending::text || '/state.png', now()),
    (v_trip_states, v_unpaid, 'M2.5 Unpaid', 'member', 'going', v_unpaid::text || '/state.png', now()),
    (v_trip_states, v_zero_due, 'M2.5 Zero Due', 'member', 'maybe', null, null),
    (v_trip_states, v_leaver, 'M2.5 Lifecycle', 'member', 'going', v_leaver::text || '/state.png', now());

  insert into public.contributions(trip_id, contributor_id)
  select v_trip_main, member_id
  from unnest(array[v_owner, v_main_member, v_main_maybe, v_main_not_going]::uuid[]) as member_id
  union all
  select v_trip_states, member_id
  from unnest(array[v_owner, v_partial, v_paid, v_pending, v_unpaid, v_zero_due, v_leaver]::uuid[]) as member_id;

  insert into public.payment_submissions(
    id, trip_id, contributor_id, client_request_id, request_hash, amount,
    payment_method, payment_occurred_at, status, verified_by, verified_at,
    rejected_by, rejected_at, rejection_reason, resubmission_of, note
  ) values
    (v_payment_main_pending, v_trip_main, v_main_member, gen_random_uuid(), repeat('a', 64), 2000,
      'cash', now(), 'pending', null, null, null, null, null, null, 'main pending'),
    (v_payment_main_verified, v_trip_main, v_main_member, gen_random_uuid(), repeat('b', 64), 5000,
      'cash', now(), 'verified', v_owner, now(), null, null, null, null, 'main verified'),
    (v_payment_main_rejected, v_trip_main, v_main_member, gen_random_uuid(), repeat('c', 64), 900,
      'cash', now(), 'rejected', null, null, v_owner, now(), 'Rejected amount', null, 'main rejected'),
    (v_chain_a, v_trip_states, v_partial, gen_random_uuid(), repeat('d', 64), 0.10,
      'cash', now(), 'rejected', null, null, v_owner, now(), 'First attempt', null, 'A'),
    (v_chain_b, v_trip_states, v_partial, gen_random_uuid(), repeat('e', 64), 0.20,
      'cash', now(), 'rejected', null, null, v_owner, now(), 'Second attempt', v_chain_a, 'B'),
    (v_chain_c, v_trip_states, v_partial, gen_random_uuid(), repeat('f', 64), 0.10,
      'cash', now(), 'pending', null, null, null, null, null, v_chain_b, 'C'),
    (v_payment_decimal_b, v_trip_states, v_partial, gen_random_uuid(), repeat('1', 64), 0.20,
      'cash', now(), 'pending', null, null, null, null, null, null, 'Decimal part B'),
    (gen_random_uuid(), v_trip_states, v_partial, gen_random_uuid(), repeat('2', 64), 3.00,
      'cash', now(), 'verified', v_owner, now(), null, null, null, null, 'partial verified'),
    (gen_random_uuid(), v_trip_states, v_paid, gen_random_uuid(), repeat('3', 64), 15.00,
      'cash', now(), 'verified', v_owner, now(), null, null, null, null, 'paid overpayment'),
    (gen_random_uuid(), v_trip_states, v_pending, gen_random_uuid(), repeat('4', 64), 2.00,
      'cash', now(), 'pending', null, null, null, null, null, null, 'pending only'),
    (gen_random_uuid(), v_trip_states, v_zero_due, gen_random_uuid(), repeat('5', 64), 1.00,
      'cash', now(), 'pending', null, null, null, null, null, null, 'zero due pending'),
    (gen_random_uuid(), v_trip_states, v_leaver, gen_random_uuid(), repeat('6', 64), 4.00,
      'cash', now(), 'pending', null, null, null, null, null, null, 'former pending'),
    (gen_random_uuid(), v_trip_states, v_leaver, gen_random_uuid(), repeat('7', 64), 6.00,
      'cash', now(), 'verified', v_owner, now(), null, null, null, null, 'former verified');

  -- Two current Going members at 3,500 each. Rejected submissions do not affect either total.
  v_summary := public.get_trip_money_summary(v_owner, v_trip_main);
  if v_summary is distinct from jsonb_build_object(
    'currency', 'THB',
    'budgetPerPerson', '3500.00',
    'expected', '7000.00',
    'pending', '2000.00',
    'collected', '5000.00',
    'spent', '0.00',
    'available', '5000.00',
    'goingCount', 2
  ) then
    raise exception '3500 summary mismatch: %', v_summary;
  end if;

  v_list := public.get_trip_member_contributions(v_owner, v_trip_main);
  if jsonb_array_length(v_list) <> 4 then raise exception 'owner did not receive every current member'; end if;
  select entry into v_entry
  from jsonb_array_elements(v_list) as entry
  where entry ->> 'contributorId' = v_main_member::text;
  if v_entry is null
     or v_entry ->> 'expected' <> '3500.00'
     or v_entry ->> 'pending' <> '2000.00'
     or v_entry ->> 'verified' <> '5000.00'
     or v_entry ->> 'remaining' <> '0.00'
     or v_entry ->> 'overpaid' <> '1500.00'
     or v_entry ->> 'status' <> 'paid' then
    raise exception 'member breakdown did not apply exact formulas: %', v_entry;
  end if;

  select entry into v_entry
  from jsonb_array_elements(v_list) as entry
  where entry ->> 'contributorId' = v_owner::text;
  if v_entry is null or v_entry ->> 'status' <> 'unpaid' or v_entry ->> 'expected' <> '3500.00' then
    raise exception 'owner Going member without payments was omitted or misclassified: %', v_entry;
  end if;

  -- Owner sees all rows. A current member sees only their own row. Former/nonmembers are hidden.
  if public.get_trip_money_summary(v_main_member, v_trip_main) is null then
    raise exception 'current member could not read the summary';
  end if;
  v_result := public.get_trip_member_contributions(v_owner, v_trip_main);
  if jsonb_array_length(v_result) <> 4 then raise exception 'owner list is not complete'; end if;
  v_result := public.get_trip_member_contributions(v_main_member, v_trip_main);
  if jsonb_array_length(v_result) <> 1
     or v_result -> 0 ->> 'contributorId' <> v_main_member::text then
    raise exception 'current member did not receive only their own entry: %', v_result;
  end if;
  if public.get_trip_money_summary(v_outsider, v_trip_main) is not null
     or public.get_trip_member_contributions(v_outsider, v_trip_main) is not null
     or public.get_trip_money_summary(v_main_maybe, gen_random_uuid()) is not null then
    raise exception 'nonmember or missing trip was authorized';
  end if;

  if public.get_trip_money_summary(v_owner, v_trip_empty) is distinct from jsonb_build_object(
       'currency', 'THB', 'budgetPerPerson', '50.00', 'expected', '0.00',
       'pending', '0.00', 'collected', '0.00', 'spent', '0.00',
       'available', '0.00', 'goingCount', 0
     )
     or public.get_trip_member_contributions(v_owner, v_trip_empty) is distinct from '[]'::jsonb then
    raise exception 'empty trip did not return zero totals and an empty member list';
  end if;

  -- All statuses and 0.10 + 0.20 are derived exactly; rejected A/B are excluded from pending.
  v_list := public.get_trip_member_contributions(v_owner, v_trip_states);
  select entry into v_entry from jsonb_array_elements(v_list) as entry
    where entry ->> 'contributorId' = v_partial::text;
  if v_entry is null or v_entry ->> 'expected' <> '10.00' or v_entry ->> 'pending' <> '0.30'
     or v_entry ->> 'verified' <> '3.00' or v_entry ->> 'remaining' <> '7.00'
     or v_entry ->> 'overpaid' <> '0.00' or v_entry ->> 'status' <> 'partial' then
    raise exception 'partial or exact decimal calculation failed: %', v_entry;
  end if;
  select entry into v_entry from jsonb_array_elements(v_list) as entry
    where entry ->> 'contributorId' = v_paid::text;
  if v_entry is null or v_entry ->> 'status' <> 'paid' or v_entry ->> 'remaining' <> '0.00'
     or v_entry ->> 'overpaid' <> '5.00' then raise exception 'paid status/overpayment failed: %', v_entry; end if;
  select entry into v_entry from jsonb_array_elements(v_list) as entry
    where entry ->> 'contributorId' = v_pending::text;
  if v_entry is null or v_entry ->> 'status' <> 'pending' then raise exception 'pending-only status failed: %', v_entry; end if;
  select entry into v_entry from jsonb_array_elements(v_list) as entry
    where entry ->> 'contributorId' = v_unpaid::text;
  if v_entry is null or v_entry ->> 'status' <> 'unpaid' then raise exception 'unpaid status failed: %', v_entry; end if;
  select entry into v_entry from jsonb_array_elements(v_list) as entry
    where entry ->> 'contributorId' = v_zero_due::text;
  if v_entry is null or v_entry ->> 'status' <> 'not_due' or v_entry ->> 'pending' <> '1.00'
     or v_entry ->> 'expected' <> '0.00' then raise exception 'not_due precedence failed: %', v_entry; end if;

  -- Budget and attendance are read-time inputs; ledger rows remain unchanged.
  select sum(amount) filter (where status = 'pending'),
         sum(amount) filter (where status = 'verified')
    into v_pending_before, v_verified_before
  from public.payment_submissions where trip_id = v_trip_main;
  update public.trips set budget_per_person = 4000 where id = v_trip_main;
  v_summary := public.get_trip_money_summary(v_owner, v_trip_main);
  if v_summary ->> 'expected' <> '8000.00' then raise exception 'budget change did not update expected: %', v_summary; end if;
  update public.trip_members
    set attendance = 'not_going', signature_path = null, commitment_signed_at = null
  where trip_id = v_trip_main and user_id = v_main_member;
  v_summary := public.get_trip_money_summary(v_owner, v_trip_main);
  if v_summary ->> 'expected' <> '4000.00' or v_summary ->> 'goingCount' <> '1' then
    raise exception 'Going → Not Going did not reduce expected: %', v_summary;
  end if;
  update public.trip_members
    set attendance = 'going', signature_path = v_main_member::text || '/restored.png', commitment_signed_at = now()
  where trip_id = v_trip_main and user_id = v_main_member;
  v_summary := public.get_trip_money_summary(v_owner, v_trip_main);
  if v_summary ->> 'expected' <> '8000.00' or v_summary ->> 'goingCount' <> '2' then
    raise exception 'Not Going → Going did not restore expected: %', v_summary;
  end if;
  if (select sum(amount) filter (where status = 'pending') from public.payment_submissions where trip_id = v_trip_main)
       is distinct from v_pending_before
     or (select sum(amount) filter (where status = 'verified') from public.payment_submissions where trip_id = v_trip_main)
       is distinct from v_verified_before then
    raise exception 'budget/attendance changed ledger rows';
  end if;

  -- Leaving retains the ledger/account; rejoining restores a current row with the existing history.
  delete from public.trip_members where trip_id = v_trip_states and user_id = v_leaver;
  v_list := public.get_trip_member_contributions(v_owner, v_trip_states);
  select entry into v_entry from jsonb_array_elements(v_list) as entry
    where entry ->> 'contributorId' = v_leaver::text;
  if v_entry is null or v_entry ->> 'isCurrentMember' <> 'false'
     or v_entry -> 'attendance' <> 'null'::jsonb
     or v_entry ->> 'expected' <> '0.00'
     or v_entry ->> 'pending' <> '4.00'
     or v_entry ->> 'verified' <> '6.00'
     or v_entry ->> 'status' <> 'not_due' then
    raise exception 'former member money history was not retained: %', v_entry;
  end if;
  if public.get_trip_money_summary(v_leaver, v_trip_states) is not null
     or public.get_trip_member_contributions(v_leaver, v_trip_states) is not null then
    raise exception 'former member retained read access after leaving';
  end if;
  if exists(select 1 from public.contributions where trip_id = v_trip_states and contributor_id = v_leaver) is false
     or exists(select 1 from public.payment_submissions where trip_id = v_trip_states and contributor_id = v_leaver) is false then
    raise exception 'leave deleted the contribution account or ledger';
  end if;

  insert into public.trip_members(trip_id, user_id, display_name, role, attendance)
  values (v_trip_states, v_leaver, 'M2.5 Lifecycle', 'member', 'maybe');
  v_list := public.get_trip_member_contributions(v_owner, v_trip_states);
  select entry into v_entry from jsonb_array_elements(v_list) as entry
    where entry ->> 'contributorId' = v_leaver::text;
  if v_entry is null or v_entry ->> 'isCurrentMember' <> 'true' or v_entry ->> 'attendance' <> 'maybe'
     or v_entry ->> 'expected' <> '0.00' or v_entry ->> 'pending' <> '4.00'
     or v_entry ->> 'verified' <> '6.00' then
    raise exception 'rejoin did not retain history or restore current-member state: %', v_entry;
  end if;
  update public.trip_members
    set attendance = 'going', signature_path = v_leaver::text || '/rejoined.png', commitment_signed_at = now()
  where trip_id = v_trip_states and user_id = v_leaver;
  v_list := public.get_trip_member_contributions(v_owner, v_trip_states);
  select entry into v_entry from jsonb_array_elements(v_list) as entry
    where entry ->> 'contributorId' = v_leaver::text;
  if v_entry is null or v_entry ->> 'expected' <> '10.00' or v_entry ->> 'pending' <> '4.00'
     or v_entry ->> 'verified' <> '6.00' then
    raise exception 'going after rejoin did not recompute expected over retained ledger: %', v_entry;
  end if;

  -- An authorized identity cannot use a missing trip; an actor without a profile cannot read.
  if public.get_trip_money_summary(gen_random_uuid(), v_trip_main) is not null
     or public.get_trip_member_contributions(gen_random_uuid(), v_trip_main) is not null then
    raise exception 'unknown profile was authorized';
  end if;
end;
$$;

reset role;

do $$
begin
  if has_function_privilege('anon', 'public.get_trip_money_summary(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.get_trip_money_summary(uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.get_trip_member_contributions(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.get_trip_member_contributions(uuid,uuid)', 'execute') then
    raise exception 'browser role can execute money read RPCs';
  end if;
  if not has_function_privilege('service_role', 'public.get_trip_money_summary(uuid,uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.get_trip_member_contributions(uuid,uuid)', 'execute') then
    raise exception 'service_role cannot execute money read RPCs';
  end if;
  if exists (
    select 1 from pg_proc p
    where p.oid in (
      'public.get_trip_money_summary(uuid,uuid)'::regprocedure,
      'public.get_trip_member_contributions(uuid,uuid)'::regprocedure
    )
      and (p.provolatile <> 's' or p.prosecdef or not coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%')
  ) then
    raise exception 'money read RPCs must be stable, invoker-security, and use an empty search_path';
  end if;
end;
$$;

rollback;
