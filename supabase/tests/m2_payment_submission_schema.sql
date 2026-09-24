-- Run against a disposable Paipa database after M2.2 migrations.
-- This is a schema acceptance test: it does not represent submit/review API behavior.
-- All fixture rows and RPC mutations roll back at the end.
begin;

insert into public.profiles(id, display_name) values
  ('40000000-0000-0000-0000-000000000001', 'M2 Payment Owner'),
  ('40000000-0000-0000-0000-000000000002', 'M2 Payment Member'),
  ('40000000-0000-0000-0000-000000000003', 'M2 Payment Reviewer'),
  ('40000000-0000-0000-0000-000000000004', 'M2 Payment Without Account');

set local role service_role;

do $$
declare
  v_owner constant uuid := '40000000-0000-0000-0000-000000000001';
  v_member constant uuid := '40000000-0000-0000-0000-000000000002';
  v_reviewer constant uuid := '40000000-0000-0000-0000-000000000003';
  v_unaccounted constant uuid := '40000000-0000-0000-0000-000000000004';
  v_request_id constant uuid := '40000000-0000-0000-0000-000000000101';
  v_trip_a uuid;
  v_trip_b uuid;
  v_parent uuid;
  v_child uuid;
  v_child_c uuid;
  v_self_id uuid := gen_random_uuid();
  v_rejected boolean;
begin
  v_trip_a := public.create_trip(v_owner, 'M2 Payment A', '', '', '2026-12-01', '2026-12-02', 3500, 5);
  v_trip_b := public.create_trip(v_owner, 'M2 Payment B', '', '', '2026-12-03', '2026-12-04', 3500, 5);
  perform public.create_invite(v_owner, v_trip_a, 'M2PaymentTripA', now() + interval '1 day');
  perform public.create_invite(v_owner, v_trip_b, 'M2PaymentTripB', now() + interval '1 day');
  perform public.join_trip(v_member, 'M2PaymentTripA', 'M2 Payment Member', 'emoji', '');
  perform public.join_trip(v_member, 'M2PaymentTripB', 'M2 Payment Member', 'emoji', '');

  -- A valid pending cash submission needs no proof or reviewer data.
  insert into public.payment_submissions (
    trip_id, contributor_id, client_request_id, request_hash, amount,
    payment_method, payment_occurred_at, note
  ) values (
    v_trip_a, v_member, v_request_id, repeat('a', 64), 4000.25,
    'cash', now(), 'cash handoff'
  );
  if not exists (
    select 1 from public.payment_submissions
    where trip_id = v_trip_a and contributor_id = v_member
      and client_request_id = v_request_id and status = 'pending'
      and verified_by is null and verified_at is null
      and rejected_by is null and rejected_at is null and rejection_reason is null
  ) then
    raise exception 'valid pending submission or pending state defaults are wrong';
  end if;

  -- The request ID is unique only within its trip and contributor scope.
  insert into public.payment_submissions (
    trip_id, contributor_id, client_request_id, request_hash, amount,
    payment_method, payment_occurred_at
  ) values (v_trip_a, v_owner, v_request_id, repeat('b', 64), 1, 'other', now());
  insert into public.payment_submissions (
    trip_id, contributor_id, client_request_id, request_hash, amount,
    payment_method, payment_occurred_at
  ) values (v_trip_b, v_member, v_request_id, repeat('c', 64), 1, 'other', now());

  v_rejected := false;
  begin
    insert into public.payment_submissions (
      trip_id, contributor_id, client_request_id, request_hash, amount,
      payment_method, payment_occurred_at
    ) values (v_trip_a, v_member, v_request_id, repeat('d', 64), 2, 'cash', now());
  exception when unique_violation then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'duplicate request ID for one trip/contributor was accepted'; end if;

  v_rejected := false;
  begin
    insert into public.payment_submissions (
      trip_id, contributor_id, client_request_id, request_hash, amount,
      payment_method, payment_occurred_at
    ) values (v_trip_a, v_member, gen_random_uuid(), repeat('e', 64), 0, 'cash', now());
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'zero amount was accepted'; end if;

  v_rejected := false;
  begin
    insert into public.payment_submissions (
      trip_id, contributor_id, client_request_id, request_hash, amount,
      payment_method, payment_occurred_at
    ) values (v_trip_a, v_member, gen_random_uuid(), repeat('f', 64), -0.01, 'cash', now());
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'negative amount was accepted'; end if;

  v_rejected := false;
  begin
    insert into public.payment_submissions (
      trip_id, contributor_id, client_request_id, request_hash, amount,
      payment_method, payment_occurred_at
    ) values (v_trip_a, v_member, gen_random_uuid(), repeat('0', 64), 10000000000.00, 'cash', now());
  exception when numeric_value_out_of_range then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'amount exceeded numeric(12,2) storage range'; end if;

  v_rejected := false;
  begin
    insert into public.payment_submissions (
      trip_id, contributor_id, client_request_id, request_hash, amount,
      payment_method, payment_occurred_at
    ) values (v_trip_a, v_member, gen_random_uuid(), repeat('1', 64), 1, 'crypto', now());
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'unsupported payment method was accepted'; end if;

  v_rejected := false;
  begin
    insert into public.payment_submissions (
      trip_id, contributor_id, client_request_id, request_hash, amount,
      payment_method, payment_occurred_at
    ) values (v_trip_a, v_member, gen_random_uuid(), 'xyz', 1, 'cash', now());
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'malformed request hash was accepted'; end if;

  v_rejected := false;
  begin
    insert into public.payment_submissions (
      trip_id, contributor_id, client_request_id, request_hash, amount,
      payment_method, payment_occurred_at, proof_path
    ) values (v_trip_a, v_member, gen_random_uuid(), repeat('2', 64), 1, 'bank_transfer', now(), null);
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'bank transfer without proof path was accepted'; end if;

  v_rejected := false;
  begin
    insert into public.payment_submissions (
      trip_id, contributor_id, client_request_id, request_hash, amount,
      payment_method, payment_occurred_at, proof_path
    ) values (v_trip_a, v_member, gen_random_uuid(), repeat('3', 64), 1, 'bank_transfer', now(), ' ');
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'bank transfer with an empty proof path was accepted'; end if;

  insert into public.payment_submissions (
    trip_id, contributor_id, client_request_id, request_hash, amount,
    payment_method, payment_occurred_at, proof_path
  ) values (v_trip_a, v_member, gen_random_uuid(), repeat('4', 64), 1, 'bank_transfer', now(), 'm2-test/proof.png');

  v_rejected := false;
  begin
    insert into public.payment_submissions (
      trip_id, contributor_id, client_request_id, request_hash, amount,
      payment_method, payment_occurred_at, proof_path
    ) values (v_trip_a, v_owner, gen_random_uuid(), repeat('5', 64), 1, 'other', now(), 'm2-test/proof.png');
  exception when unique_violation then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'proof path was not unique'; end if;

  v_rejected := false;
  begin
    insert into public.payment_submissions (
      trip_id, contributor_id, client_request_id, request_hash, amount,
      payment_method, payment_occurred_at, verified_by
    ) values (v_trip_a, v_member, gen_random_uuid(), repeat('6', 64), 1, 'cash', now(), v_reviewer);
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'pending submission accepted verification fields'; end if;

  v_rejected := false;
  begin
    insert into public.payment_submissions (
      trip_id, contributor_id, client_request_id, request_hash, amount,
      payment_method, payment_occurred_at, status
    ) values (v_trip_a, v_member, gen_random_uuid(), repeat('7', 64), 1, 'cash', now(), 'verified');
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'verified submission without reviewer fields was accepted'; end if;

  insert into public.payment_submissions (
    trip_id, contributor_id, client_request_id, request_hash, amount,
    payment_method, payment_occurred_at, status, verified_by, verified_at
  ) values (v_trip_a, v_member, gen_random_uuid(), repeat('8', 64), 10, 'cash', now(), 'verified', v_reviewer, now());

  v_rejected := false;
  begin
    insert into public.payment_submissions (
      trip_id, contributor_id, client_request_id, request_hash, amount,
      payment_method, payment_occurred_at, status, rejected_by, rejected_at, rejection_reason
    ) values (v_trip_a, v_member, gen_random_uuid(), repeat('9', 64), 1, 'cash', now(), 'rejected', v_reviewer, now(), '  ');
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'rejected submission accepted an empty reason'; end if;

  insert into public.payment_submissions (
    trip_id, contributor_id, client_request_id, request_hash, amount,
    payment_method, payment_occurred_at, status, rejected_by, rejected_at, rejection_reason
  ) values (v_trip_a, v_member, gen_random_uuid(), repeat('a', 64), 1, 'cash', now(), 'rejected', v_reviewer, now(), 'Need a clearer receipt')
  returning id into v_parent;

  v_rejected := false;
  begin
    insert into public.payment_submissions (
      id, trip_id, contributor_id, client_request_id, request_hash, amount,
      payment_method, payment_occurred_at, resubmission_of
    ) values (gen_random_uuid(), v_trip_a, v_owner, gen_random_uuid(), repeat('c', 64), 1, 'cash', now(), v_parent);
  exception when foreign_key_violation then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'resubmission crossed contributors'; end if;

  v_rejected := false;
  begin
    insert into public.payment_submissions (
      id, trip_id, contributor_id, client_request_id, request_hash, amount,
      payment_method, payment_occurred_at, resubmission_of
    ) values (gen_random_uuid(), v_trip_b, v_member, gen_random_uuid(), repeat('d', 64), 1, 'cash', now(), v_parent);
  exception when foreign_key_violation then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'resubmission crossed trips'; end if;

  insert into public.payment_submissions (
    trip_id, contributor_id, client_request_id, request_hash, amount,
    payment_method, payment_occurred_at, resubmission_of
  ) values (v_trip_a, v_member, gen_random_uuid(), repeat('b', 64), 1, 'cash', now(), v_parent)
  returning id into v_child;

  v_rejected := false;
  begin
    insert into public.payment_submissions (
      id, trip_id, contributor_id, client_request_id, request_hash, amount,
      payment_method, payment_occurred_at, resubmission_of
    ) values (gen_random_uuid(), v_trip_a, v_member, gen_random_uuid(), repeat('e', 64), 1, 'cash', now(), v_parent);
  exception when unique_violation then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'one parent accepted multiple children'; end if;

  v_rejected := false;
  begin
    insert into public.payment_submissions (
      id, trip_id, contributor_id, client_request_id, request_hash, amount,
      payment_method, payment_occurred_at, resubmission_of
    ) values (v_self_id, v_trip_a, v_member, gen_random_uuid(), repeat('f', 64), 1, 'cash', now(), v_self_id);
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'resubmission referenced itself'; end if;

  v_rejected := false;
  begin
    update public.payment_submissions set resubmission_of = null where id = v_child;
  exception when raise_exception then
    if sqlerrm = 'Resubmission parent is immutable' then v_rejected := true; else raise; end if;
  end;
  if not v_rejected then raise exception 'resubmission parent was mutable after insert'; end if;

  update public.payment_submissions
  set status = 'rejected', rejected_by = v_reviewer, rejected_at = now(), rejection_reason = 'Still missing details'
  where id = v_child;
  insert into public.payment_submissions (
    trip_id, contributor_id, client_request_id, request_hash, amount,
    payment_method, payment_occurred_at, resubmission_of
  ) values (v_trip_a, v_member, gen_random_uuid(), repeat('0', 64), 1, 'cash', now(), v_child)
  returning id into v_child_c;
  if not exists (
    select 1 from public.payment_submissions
    where id = v_child_c and status = 'pending' and resubmission_of = v_child
  ) then
    raise exception 'rejected resubmission chain did not allow a new pending child';
  end if;

  v_rejected := false;
  begin
    insert into public.payment_submissions (
      trip_id, contributor_id, client_request_id, request_hash, amount, payment_method, payment_occurred_at
    ) values (v_trip_a, v_unaccounted, gen_random_uuid(), repeat('1', 64), 1, 'cash', now());
  exception when foreign_key_violation then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'submission without a contribution account was accepted'; end if;

  v_rejected := false;
  begin
    perform public.delete_trip(v_owner, v_trip_a);
  exception when foreign_key_violation then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'trip with payment history was hard-deleted'; end if;
end;
$$;

reset role;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.payment_submissions'::regclass) then
    raise exception 'payment_submissions must have row-level security enabled';
  end if;
  if has_table_privilege('anon', 'public.payment_submissions', 'select')
     or has_table_privilege('authenticated', 'public.payment_submissions', 'select') then
    raise exception 'browser roles must not have direct payment submission access';
  end if;
  if not has_table_privilege('service_role', 'public.payment_submissions', 'select,insert,update,delete') then
    raise exception 'server service_role must access payment submissions';
  end if;
  if to_regclass('public.payment_submissions_pending_queue_idx') is null
     or to_regclass('public.payment_submissions_contributor_history_idx') is null
     or to_regclass('public.payment_submissions_resubmission_scope_idx') is null
     or to_regclass('public.payment_submissions_proof_path_uidx') is null
     or to_regclass('public.payment_submissions_resubmission_parent_uidx') is null then
    raise exception 'one or more required payment submission indexes are missing';
  end if;
end;
$$;

rollback;
