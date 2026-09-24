begin;
set local role service_role;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_trip uuid := gen_random_uuid();
  v_submission uuid := gen_random_uuid();
  v_rejected boolean := false;
  v_bucket record;
begin
  insert into public.profiles(id, display_name) values (v_owner, 'M2.3 cap test');
  insert into public.trips(owner_id, name, start_date, end_date)
  values (v_owner, 'M2.3 amount cap', current_date, current_date)
  returning id into v_trip;
  insert into public.trip_members(trip_id, user_id, display_name, role, attendance)
  values (v_trip, v_owner, 'M2.3 cap test', 'owner', 'maybe');
  insert into public.contributions(trip_id, contributor_id) values (v_trip, v_owner);

  begin
    insert into public.payment_submissions (
      id, trip_id, contributor_id, client_request_id, request_hash,
      amount, payment_method, payment_occurred_at
    ) values (
      v_submission, v_trip, v_owner, gen_random_uuid(), repeat('a', 64),
      100000000.01, 'cash', now()
    );
  exception when check_violation then
    v_rejected := true;
  end;

  if not v_rejected then
    raise exception 'payment_submissions accepted an amount above the M2.3 cap';
  end if;

  insert into public.payment_submissions (
    id, trip_id, contributor_id, client_request_id, request_hash,
    amount, payment_method, payment_occurred_at
  ) values (
    v_submission, v_trip, v_owner, gen_random_uuid(), repeat('b', 64),
    100000000.00, 'cash', now()
  );

  if not exists (
    select 1 from public.payment_submissions
    where id = v_submission and amount = 100000000.00
  ) then
    raise exception 'the inclusive M2.3 amount cap was not stored exactly';
  end if;

  select id, name, public, file_size_limit, allowed_mime_types
    into v_bucket
    from storage.buckets where id = 'payment-proofs';
  if not found then
    raise exception 'private payment-proofs bucket is missing';
  end if;
  if v_bucket.public is distinct from false then
    raise exception 'payment-proofs bucket must be private';
  end if;
  if v_bucket.file_size_limit is distinct from 10485760::bigint then
    raise exception 'payment-proofs bucket must enforce a 10 MiB limit';
  end if;
  if v_bucket.allowed_mime_types is distinct from array[
    'image/png', 'image/jpeg', 'image/webp', 'application/pdf'
  ]::text[] then
    raise exception 'payment-proofs bucket MIME allowlist is incorrect';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and coalesce(qual, '') || ' ' || coalesce(with_check, '') ilike '%payment-proofs%'
  ) then
    raise exception 'payment-proofs must not have a direct browser Storage policy';
  end if;
end;
$$;

rollback;
