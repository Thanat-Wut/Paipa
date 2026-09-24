-- M2.4 acceptance test. Run after its migration; the full fixture and RPC
-- lifecycle rolls back at the end.
begin;

set local role service_role;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_former uuid := gen_random_uuid();
  v_random uuid := gen_random_uuid();
  v_trip uuid;
  v_code text := 'M24' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);
  v_verify_id uuid := gen_random_uuid();
  v_reject_id uuid := gen_random_uuid();
  v_former_verify_id uuid := gen_random_uuid();
  v_former_reject_id uuid := gen_random_uuid();
  v_archived_review_id uuid := gen_random_uuid();
  v_archived_reject_id uuid := gen_random_uuid();
  v_parent_id uuid := gen_random_uuid();
  v_child_id uuid := gen_random_uuid();
  v_grandchild_id uuid := gen_random_uuid();
  v_reason_500_id uuid := gen_random_uuid();
  v_pending_parent_id uuid := gen_random_uuid();
  v_verified_parent_id uuid := gen_random_uuid();
  v_archived_parent_id uuid := gen_random_uuid();
  v_rejected boolean;
  v_result uuid;
begin
  insert into public.profiles(id, display_name) values
    (v_owner, 'M2.4 Review Owner'),
    (v_member, 'M2.4 Review Member'),
    (v_other, 'M2.4 Review Other'),
    (v_former, 'M2.4 Review Former');

  v_trip := public.create_trip(v_owner, 'M2.4 review SQL test', '', 'Bangkok', '2026-12-01', '2026-12-02', 3500, 6);
  perform public.create_invite(v_owner, v_trip, v_code, now() + interval '1 day');
  perform public.join_trip(v_member, v_code, 'M2.4 Review Member', 'emoji', '');
  perform public.join_trip(v_other, v_code, 'M2.4 Review Other', 'emoji', '');
  perform public.join_trip(v_former, v_code, 'M2.4 Review Former', 'emoji', '');

  insert into public.payment_submissions (
    id, trip_id, contributor_id, client_request_id, request_hash, amount,
    payment_method, payment_occurred_at, proof_path, note
  ) values
    (v_verify_id, v_trip, v_member, gen_random_uuid(), repeat('a', 64), 100, 'bank_transfer', now(), v_trip::text || '/' || v_member::text || '/' || v_verify_id::text || '/verify.png', 'verify'),
    (v_reject_id, v_trip, v_member, gen_random_uuid(), repeat('b', 64), 200, 'bank_transfer', now(), v_trip::text || '/' || v_member::text || '/' || v_reject_id::text || '/reject.png', 'reject'),
    (v_former_verify_id, v_trip, v_former, gen_random_uuid(), repeat('c', 64), 300, 'cash', now(), null, 'former verify'),
    (v_former_reject_id, v_trip, v_former, gen_random_uuid(), repeat('d', 64), 400, 'cash', now(), null, 'former reject'),
    (v_archived_review_id, v_trip, v_member, gen_random_uuid(), repeat('e', 64), 500, 'cash', now(), null, 'archived review'),
    (v_archived_reject_id, v_trip, v_member, gen_random_uuid(), repeat('0', 64), 510, 'cash', now(), null, 'archived reject'),
    (v_parent_id, v_trip, v_member, gen_random_uuid(), repeat('f', 64), 600, 'bank_transfer', now(), v_trip::text || '/' || v_member::text || '/' || v_parent_id::text || '/parent.png', 'parent'),
    (v_pending_parent_id, v_trip, v_member, gen_random_uuid(), repeat('1', 64), 700, 'cash', now(), null, 'pending parent'),
    (v_verified_parent_id, v_trip, v_member, gen_random_uuid(), repeat('2', 64), 800, 'cash', now(), null, 'verified parent'),
    (v_archived_parent_id, v_trip, v_member, gen_random_uuid(), repeat('4', 64), 1000, 'cash', now(), null, 'archived parent'),
    (v_reason_500_id, v_trip, v_member, gen_random_uuid(), repeat('5', 64), 1100, 'cash', now(), null, 'reason length');

  -- Authorization is checked inside the RPC, including for service_role calls.
  v_rejected := false;
  begin
    perform public.verify_payment(v_member, v_trip, v_verify_id);
  exception when insufficient_privilege then
    v_rejected := sqlerrm = 'NOT_OWNER';
  end;
  if not v_rejected then raise exception 'contributor verified a payment'; end if;

  v_rejected := false;
  begin
    perform public.reject_payment(v_other, v_trip, v_reject_id, 'Not owner');
  exception when insufficient_privilege then
    v_rejected := sqlerrm = 'NOT_OWNER';
  end;
  if not v_rejected then raise exception 'other member rejected a payment'; end if;

  v_rejected := false;
  begin
    perform public.verify_payment(v_random, v_trip, v_verify_id);
  exception when no_data_found then
    v_rejected := sqlerrm = 'IDENTITY_NOT_FOUND';
  end;
  if not v_rejected then raise exception 'unknown identity reviewed a payment'; end if;

  -- Verify writes only verified fields and the owner is recorded as reviewer.
  v_result := public.verify_payment(v_owner, v_trip, v_verify_id);
  if v_result <> v_verify_id or not exists (
    select 1 from public.payment_submissions
    where id = v_verify_id and status = 'verified'
      and verified_by = v_owner and verified_at is not null
      and rejected_by is null and rejected_at is null and rejection_reason is null
      and amount = 100 and note = 'verify'
  ) then
    raise exception 'owner verify did not record an atomic verified state';
  end if;

  -- A reviewed payment cannot be verified or rejected a second time.
  v_rejected := false;
  begin
    perform public.verify_payment(v_owner, v_trip, v_verify_id);
  exception when raise_exception then
    v_rejected := sqlerrm = 'PAYMENT_ALREADY_REVIEWED';
  end;
  if not v_rejected then raise exception 'verified payment was verified again'; end if;

  v_rejected := false;
  begin
    perform public.reject_payment(v_owner, v_trip, v_verify_id, 'Wrong');
  exception when raise_exception then
    v_rejected := sqlerrm = 'PAYMENT_ALREADY_REVIEWED';
  end;
  if not v_rejected then raise exception 'verified payment was rejected'; end if;

  -- Reject trims the reason and writes only rejected review fields.
  v_result := public.reject_payment(v_owner, v_trip, v_reject_id, '  Receipt is unreadable  ');
  if v_result <> v_reject_id or not exists (
    select 1 from public.payment_submissions
    where id = v_reject_id and status = 'rejected'
      and rejected_by = v_owner and rejected_at is not null
      and rejection_reason = 'Receipt is unreadable'
      and verified_by is null and verified_at is null
      and amount = 200 and note = 'reject'
  ) then
    raise exception 'owner reject did not record an atomic rejected state';
  end if;

  v_rejected := false;
  begin
    perform public.verify_payment(v_owner, v_trip, v_reject_id);
  exception when raise_exception then
    v_rejected := sqlerrm = 'PAYMENT_ALREADY_REVIEWED';
  end;
  if not v_rejected then raise exception 'rejected payment was verified'; end if;

  v_rejected := false;
  begin
    perform public.reject_payment(v_owner, v_trip, v_reject_id, 'Again');
  exception when raise_exception then
    v_rejected := sqlerrm = 'PAYMENT_ALREADY_REVIEWED';
  end;
  if not v_rejected then raise exception 'rejected payment was rejected again'; end if;

  v_rejected := false;
  begin
    perform public.reject_payment(v_owner, v_trip, gen_random_uuid(), 'Missing');
  exception when no_data_found then
    v_rejected := sqlerrm = 'PAYMENT_NOT_FOUND';
  end;
  if not v_rejected then raise exception 'review accepted an unknown submission'; end if;

  v_rejected := false;
  begin
    perform public.reject_payment(v_owner, v_trip, v_reason_500_id, '');
  exception when invalid_parameter_value then
    v_rejected := sqlerrm = 'VALIDATION_ERROR';
  end;
  if not v_rejected then raise exception 'empty rejection reason was accepted'; end if;

  v_rejected := false;
  begin
    perform public.reject_payment(v_owner, v_trip, v_pending_parent_id, '   ');
  exception when invalid_parameter_value then
    v_rejected := sqlerrm = 'VALIDATION_ERROR';
  end;
  if not v_rejected then raise exception 'whitespace-only rejection reason was accepted'; end if;

  v_rejected := false;
  begin
    perform public.reject_payment(v_owner, v_trip, v_pending_parent_id, E' \t\n\r');
  exception when invalid_parameter_value then
    v_rejected := sqlerrm = 'VALIDATION_ERROR';
  end;
  if not v_rejected then raise exception 'tab/newline-only rejection reason was accepted'; end if;

  v_rejected := false;
  begin
    perform public.reject_payment(v_owner, v_trip, v_pending_parent_id, repeat('x', 501));
  exception when invalid_parameter_value then
    v_rejected := sqlerrm = 'VALIDATION_ERROR';
  end;
  if not v_rejected then raise exception '501-character rejection reason was accepted'; end if;

  v_result := public.reject_payment(v_owner, v_trip, v_reason_500_id, repeat('x', 500));
  if v_result <> v_reason_500_id or not exists (
    select 1 from public.payment_submissions
    where id = v_reason_500_id and status = 'rejected'
      and char_length(rejection_reason) = 500
  ) then raise exception '500-character rejection reason was not accepted'; end if;

  -- Submitted values and terminal review data are immutable after transition.
  v_rejected := false;
  begin
    update public.payment_submissions set amount = 101 where id = v_verify_id;
  exception when raise_exception then
    v_rejected := sqlerrm = 'PAYMENT_SUBMISSION_IMMUTABLE';
  end;
  if not v_rejected then raise exception 'verified payment values were mutable'; end if;

  v_rejected := false;
  begin
    update public.payment_submissions set rejection_reason = 'edited after rejection' where id = v_reject_id;
  exception when raise_exception then
    v_rejected := sqlerrm = 'PAYMENT_SUBMISSION_IMMUTABLE';
  end;
  if not v_rejected then raise exception 'rejected payment values were mutable'; end if;

  -- A rejected payment is the only valid resubmission parent.
  v_rejected := false;
  begin
    insert into public.payment_submissions (
      trip_id, contributor_id, client_request_id, request_hash, amount,
      payment_method, payment_occurred_at, resubmission_of
    ) values (v_trip, v_member, gen_random_uuid(), repeat('5', 64), 1, 'cash', now(), v_pending_parent_id);
  exception when check_violation then
    v_rejected := sqlerrm = 'RESUBMISSION_PARENT_NOT_REJECTED';
  end;
  if not v_rejected then raise exception 'pending payment was accepted as a resubmission parent'; end if;

  v_result := public.verify_payment(v_owner, v_trip, v_verified_parent_id);
  v_rejected := false;
  begin
    insert into public.payment_submissions (
      trip_id, contributor_id, client_request_id, request_hash, amount,
      payment_method, payment_occurred_at, resubmission_of
    ) values (v_trip, v_member, gen_random_uuid(), repeat('6', 64), 1, 'cash', now(), v_verified_parent_id);
  exception when check_violation then
    v_rejected := sqlerrm = 'RESUBMISSION_PARENT_NOT_REJECTED';
  end;
  if not v_rejected then raise exception 'verified payment was accepted as a resubmission parent'; end if;

  -- Retain a real rejected-payment chain A → B → C.
  v_result := public.reject_payment(v_owner, v_trip, v_parent_id, 'Correct the amount');
  insert into public.payment_submissions (
    id, trip_id, contributor_id, client_request_id, request_hash, amount,
    payment_method, payment_occurred_at, proof_path, resubmission_of, note
  ) values (
    v_child_id, v_trip, v_member, gen_random_uuid(), repeat('7', 64), 650,
    'bank_transfer', now(), v_trip::text || '/' || v_member::text || '/' || v_child_id::text || '/child.png', v_parent_id, 'corrected'
  );
  if not exists (
    select 1 from public.payment_submissions
    where id = v_child_id and status = 'pending' and resubmission_of = v_parent_id
  ) then raise exception 'rejected payment resubmit did not create a new pending row'; end if;

  v_rejected := false;
  begin
    insert into public.payment_submissions (
      trip_id, contributor_id, client_request_id, request_hash, amount,
      payment_method, payment_occurred_at, resubmission_of
    ) values (v_trip, v_member, gen_random_uuid(), repeat('8', 64), 1, 'cash', now(), v_parent_id);
  exception when unique_violation then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'rejected payment accepted a second child'; end if;

  v_result := public.reject_payment(v_owner, v_trip, v_child_id, 'Second submission still unclear');
  insert into public.payment_submissions (
    id, trip_id, contributor_id, client_request_id, request_hash, amount,
    payment_method, payment_occurred_at, resubmission_of, note
  ) values (
    v_grandchild_id, v_trip, v_member, gen_random_uuid(), repeat('9', 64), 700,
    'cash', now(), v_child_id, 'third attempt'
  );
  if not exists (
    select 1 from public.payment_submissions
    where id = v_grandchild_id and status = 'pending' and resubmission_of = v_child_id
  ) then raise exception 'rejected resubmission chain did not create the next pending row'; end if;

  -- Contribution history survives leave; current membership is required only to resubmit.
  perform public.leave_trip(v_former, v_trip);
  if exists (select 1 from public.trip_members where trip_id = v_trip and user_id = v_former)
     or not exists (select 1 from public.contributions where trip_id = v_trip and contributor_id = v_former) then
    raise exception 'former-member lifecycle fixture did not preserve its contribution';
  end if;
  perform public.verify_payment(v_owner, v_trip, v_former_verify_id);
  perform public.reject_payment(v_owner, v_trip, v_former_reject_id, 'Member has left');

  v_rejected := false;
  begin
    insert into public.payment_submissions (
      trip_id, contributor_id, client_request_id, request_hash, amount,
      payment_method, payment_occurred_at, resubmission_of
    ) values (v_trip, v_former, gen_random_uuid(), repeat('a', 64), 1, 'cash', now(), v_former_reject_id);
  exception when insufficient_privilege then
    v_rejected := sqlerrm = 'RESUBMISSION_MEMBER_REQUIRED';
  end;
  if not v_rejected then raise exception 'former member resubmitted after leaving'; end if;

  -- Archived trips allow owner review of existing pending submissions only.
  perform public.archive_trip(v_owner, v_trip);
  perform public.verify_payment(v_owner, v_trip, v_archived_review_id);
  perform public.reject_payment(v_owner, v_trip, v_archived_reject_id, 'Archived review still allowed');
  v_result := public.reject_payment(v_owner, v_trip, v_archived_parent_id, 'Archive keeps review available');
  v_rejected := false;
  begin
    insert into public.payment_submissions (
      trip_id, contributor_id, client_request_id, request_hash, amount,
      payment_method, payment_occurred_at, resubmission_of
    ) values (v_trip, v_member, gen_random_uuid(), repeat('b', 64), 1, 'cash', now(), v_archived_parent_id);
  exception when object_not_in_prerequisite_state then
    v_rejected := sqlerrm = 'RESUBMISSION_TRIP_ARCHIVED';
  end;
  if not v_rejected then raise exception 'archived trip accepted a resubmission'; end if;
end;
$$;

reset role;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.payment_submissions'::regclass) then
    raise exception 'payment_submissions RLS was disabled';
  end if;
  if has_function_privilege('anon', 'public.verify_payment(uuid,uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.verify_payment(uuid,uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.reject_payment(uuid,uuid,uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.reject_payment(uuid,uuid,uuid,text)', 'execute') then
    raise exception 'browser roles can execute payment review RPCs';
  end if;
  if not has_function_privilege('service_role', 'public.verify_payment(uuid,uuid,uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.reject_payment(uuid,uuid,uuid,text)', 'execute') then
    raise exception 'service_role cannot execute payment review RPCs';
  end if;
end;
$$;

rollback;
