-- M2.6 SQL acceptance checks; all generated test rows are rolled back.
begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_other_member uuid := gen_random_uuid();
  v_former uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_trip uuid := gen_random_uuid();
  v_other_trip uuid := gen_random_uuid();
  v_archived_trip uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
  v_result jsonb;
  v_retry jsonb;
  v_updated_at timestamptz;
  v_deleted_at timestamptz;
  v_deleted_by uuid;
  v_reason text;
  v_denied boolean;
  v_constraint text;
  v_bad_id uuid;
  v_former_request uuid;
  v_former_expense uuid;
  v_former_replacement uuid;
  v_former_replace_request uuid;
  v_former_updated_at timestamptz;
begin
  insert into public.profiles(id, display_name) values
    (v_owner, 'M2.6 Owner'),
    (v_member, 'M2.6 Member'),
    (v_other_member, 'M2.6 Other'),
    (v_former, 'M2.6 Former'),
    (v_outsider, 'M2.6 Outsider');

  insert into public.trips(id, owner_id, name, start_date, end_date, status)
  values
    (v_trip, v_owner, 'M2.6 active trip', '2026-10-01', '2026-10-02', 'planning'),
    (v_other_trip, v_owner, 'M2.6 other trip', '2026-10-03', '2026-10-04', 'planning'),
    (v_archived_trip, v_owner, 'M2.6 archived trip', '2026-10-05', '2026-10-06', 'archived');

  insert into public.trip_members(trip_id, user_id, display_name, role, attendance)
  values
    (v_trip, v_owner, 'M2.6 Owner', 'owner', 'maybe'),
    (v_trip, v_member, 'M2.6 Member', 'member', 'maybe'),
    (v_trip, v_other_member, 'M2.6 Other', 'member', 'maybe'),
    (v_trip, v_former, 'M2.6 Former', 'member', 'maybe'),
    (v_other_trip, v_owner, 'M2.6 Owner', 'owner', 'maybe'),
    (v_archived_trip, v_owner, 'M2.6 Owner', 'owner', 'maybe');

  -- Schema amount/category/source checks are independently exercised.
  v_bad_id := gen_random_uuid();
  begin
    insert into public.expenses(
      id, trip_id, title, amount, category, payment_source, created_by, spent_at, client_request_id, request_hash
    ) values (v_bad_id, v_trip, 'bad amount', 0, 'food', 'trip_fund', v_owner, now(), gen_random_uuid(), repeat('a',64));
    raise exception 'zero amount was accepted';
  exception when check_violation then null;
  end;
  v_bad_id := gen_random_uuid();
  begin
    insert into public.expenses(
      id, trip_id, title, amount, category, payment_source, created_by, spent_at, client_request_id, request_hash
    ) values (v_bad_id, v_trip, 'negative amount', -0.01, 'food', 'trip_fund', v_owner, now(), gen_random_uuid(), repeat('a',64));
    raise exception 'negative amount was accepted';
  exception when check_violation then null;
  end;
  v_bad_id := gen_random_uuid();
  begin
    insert into public.expenses(
      id, trip_id, title, amount, category, payment_source, created_by, spent_at, client_request_id, request_hash
    ) values (v_bad_id, v_trip, 'large amount', 100000000.01, 'food', 'trip_fund', v_owner, now(), gen_random_uuid(), repeat('a',64));
    raise exception 'over-cap amount was accepted';
  exception when check_violation then null;
  end;
  v_bad_id := gen_random_uuid();
  begin
    insert into public.expenses(
      id, trip_id, title, amount, category, payment_source, created_by, spent_at, client_request_id, request_hash
    ) values (v_bad_id, v_trip, 'bad category', 1, 'refund', 'trip_fund', v_owner, now(), gen_random_uuid(), repeat('a',64));
    raise exception 'invalid category was accepted';
  exception when check_violation then null;
  end;
  v_bad_id := gen_random_uuid();
  begin
    insert into public.expenses(
      id, trip_id, title, amount, category, payment_source, created_by, spent_at, client_request_id, request_hash
    ) values (v_bad_id, v_trip, 'bad source', 1, 'food', 'cash', v_owner, now(), gen_random_uuid(), repeat('a',64));
    raise exception 'invalid payment source was accepted';
  exception when check_violation then null;
  end;
  v_bad_id := gen_random_uuid();
  begin
    insert into public.expenses(
      id, trip_id, title, amount, category, payment_source, paid_by, created_by, spent_at, client_request_id, request_hash
    ) values (v_bad_id, v_trip, 'fund with payer', 1, 'food', 'trip_fund', v_member, v_owner, now(), gen_random_uuid(), repeat('a',64));
    raise exception 'trip_fund with paid_by was accepted';
  exception when check_violation then null;
  end;
  v_bad_id := gen_random_uuid();
  begin
    insert into public.expenses(
      id, trip_id, title, amount, category, payment_source, created_by, spent_at, client_request_id, request_hash
    ) values (v_bad_id, v_trip, 'personal no payer', 1, 'food', 'personal', v_owner, now(), gen_random_uuid(), repeat('a',64));
    raise exception 'personal without paid_by was accepted';
  exception when check_violation then null;
  end;

  -- Owner can record fund and member-personal expenses; current member can record their own personal expense.
  v_result := public.create_expense(
    v_owner, v_trip, v_a, gen_random_uuid(), repeat('a',64), 'Taxi', 100.00, 'transport',
    'trip_fund', null, now(), 'fund ride', v_trip::text || '/' || v_a::text || '/' || gen_random_uuid()::text || '.png'
  );
  if (v_result ->> 'replayed')::boolean then raise exception 'new expense reported replayed'; end if;
  v_updated_at := (v_result -> 'expense' ->> 'updated_at')::timestamptz;

  v_retry := public.create_expense(
    v_owner, v_trip, gen_random_uuid(),
    (v_result -> 'expense' ->> 'client_request_id')::uuid,
    repeat('a',64), 'ignored on replay', 100, 'transport', 'trip_fund', null, now(), 'ignored', null
  );
  if (v_retry ->> 'replayed')::boolean is distinct from true
     or v_retry -> 'expense' ->> 'id' <> v_a::text then
    raise exception 'same-key retry did not replay original row: %', v_retry;
  end if;

  v_denied := false;
  begin
    perform public.create_expense(v_owner, v_trip, gen_random_uuid(),
      (v_result -> 'expense' ->> 'client_request_id')::uuid, repeat('b',64), 'different', 100,
      'transport', 'trip_fund', null, now(), '', null);
  exception when others then
    if sqlerrm = 'IDEMPOTENCY_CONFLICT' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'same key/different hash was accepted'; end if;

  v_result := public.create_expense(v_owner, v_trip, gen_random_uuid(), gen_random_uuid(), repeat('c',64),
    'Member hotel', 1200, 'accommodation', 'personal', v_member, now(), '', null);
  v_result := public.create_expense(v_member, v_trip, gen_random_uuid(), gen_random_uuid(), repeat('d',64),
    'Member meal', 250, 'food', 'personal', v_member, now(), '', null);

  v_former_request := gen_random_uuid();
  v_former_expense := gen_random_uuid();
  v_result := public.create_expense(v_former, v_trip, v_former_expense, v_former_request, repeat('9',64),
    'Former personal', 10, 'food', 'personal', v_former, now(), '', null);
  select updated_at into v_former_updated_at from public.expenses where id = v_former_expense;
  v_former_replace_request := gen_random_uuid();
  v_former_replacement := gen_random_uuid();
  v_result := public.replace_expense(
    v_former, v_trip, v_former_expense, v_former_updated_at, v_former_replacement,
    v_former_replace_request, repeat('a',64), 'Former corrected', 11, 'food', 'personal', v_former,
    now(), '', null, 'correction'
  );
  delete from public.trip_members where trip_id = v_trip and user_id = v_former;
  v_denied := false;
  begin
    perform public.create_expense(v_former, v_trip, gen_random_uuid(), v_former_request, repeat('9',64),
      'Former personal', 10, 'food', 'personal', v_former, now(), '', null);
  exception when others then
    if sqlerrm = 'EXPENSE_FORBIDDEN' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'former member replayed create idempotency key'; end if;
  v_denied := false;
  begin
    perform public.replace_expense(
      v_former, v_trip, v_former_expense, v_former_updated_at, gen_random_uuid(),
      v_former_replace_request, repeat('a',64), 'Former corrected', 11, 'food', 'personal', v_former,
      now(), '', null, 'correction'
    );
  exception when others then
    if sqlerrm = 'EXPENSE_FORBIDDEN' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'former member replayed replacement idempotency key'; end if;

  v_denied := false;
  begin
    perform public.create_expense(v_member, v_trip, gen_random_uuid(), gen_random_uuid(), repeat('e',64),
      'Not allowed fund', 1, 'food', 'trip_fund', null, now(), '', null);
  exception when others then
    if sqlerrm in ('EXPENSE_FORBIDDEN', 'EXPENSE_PAYER_NOT_MEMBER') then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'member created trip-fund expense'; end if;

  v_denied := false;
  begin
    perform public.create_expense(v_member, v_trip, gen_random_uuid(), gen_random_uuid(), repeat('f',64),
      'On behalf', 1, 'food', 'personal', v_other_member, now(), '', null);
  exception when others then
    if sqlerrm in ('EXPENSE_FORBIDDEN', 'EXPENSE_PAYER_NOT_MEMBER') then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'member created another member personal expense'; end if;

  v_denied := false;
  begin
    perform public.create_expense(v_former, v_trip, gen_random_uuid(), gen_random_uuid(), repeat('1',64),
      'Former member', 1, 'food', 'personal', v_former, now(), '', null);
  exception when others then
    if sqlerrm in ('EXPENSE_FORBIDDEN', 'EXPENSE_PAYER_NOT_MEMBER') then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'former member created expense'; end if;

  v_denied := false;
  begin
    perform public.create_expense(v_outsider, v_trip, gen_random_uuid(), gen_random_uuid(), repeat('2',64),
      'Outsider', 1, 'food', 'personal', v_outsider, now(), '', null);
  exception when others then
    if sqlerrm in ('EXPENSE_FORBIDDEN', 'EXPENSE_PAYER_NOT_MEMBER') then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'nonmember created expense'; end if;

  v_denied := false;
  begin
    perform public.create_expense(v_owner, v_archived_trip, gen_random_uuid(), gen_random_uuid(), repeat('3',64),
      'Archived', 1, 'food', 'trip_fund', null, now(), '', null);
  exception when others then
    if sqlerrm = 'TRIP_ARCHIVED' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'archived trip accepted expense'; end if;

  -- Even with a known expense on an archived trip, an outsider learns no trip state.
  v_bad_id := gen_random_uuid();
  insert into public.expenses(
    id, trip_id, title, amount, category, payment_source, created_by, spent_at,
    client_request_id, request_hash
  ) values (
    v_bad_id, v_archived_trip, 'Archived fixture', 1, 'food', 'trip_fund', v_owner, now(),
    gen_random_uuid(), repeat('3',64)
  );
  v_denied := false;
  begin
    perform public.delete_expense(v_outsider, v_archived_trip, v_bad_id, 'outsider probe');
  exception when others then
    if sqlerrm = 'EXPENSE_FORBIDDEN' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'outsider learned archived trip state'; end if;

  -- Database prevents self/cross-trip replacement and branching from an existing parent.
  v_bad_id := gen_random_uuid();
  begin
    insert into public.expenses(
      id, trip_id, title, amount, category, payment_source, created_by, spent_at,
      replaces_expense_id, client_request_id, request_hash
    ) values (v_bad_id, v_other_trip, 'cross trip', 1, 'food', 'trip_fund', v_owner, now(),
      v_a, gen_random_uuid(), repeat('4',64));
    raise exception 'cross-trip replacement was accepted';
  exception when foreign_key_violation then null;
  end;
  v_bad_id := gen_random_uuid();
  begin
    insert into public.expenses(
      id, trip_id, title, amount, category, payment_source, created_by, spent_at,
      replaces_expense_id, client_request_id, request_hash
    ) values (v_bad_id, v_trip, 'self ref', 1, 'food', 'trip_fund', v_owner, now(),
      v_bad_id, gen_random_uuid(), repeat('5',64));
    raise exception 'self replacement was accepted';
  exception when check_violation then null;
  end;

  -- A -> B -> C is atomic, one child per parent, and old receipt paths stay attached.
  v_result := public.replace_expense(
    v_owner, v_trip, v_a, v_updated_at, v_b, gen_random_uuid(), repeat('6',64), 'Taxi corrected',
    125, 'transport', 'trip_fund', null, now(), '', v_trip::text || '/' || v_b::text || '/' || gen_random_uuid()::text || '.pdf',
    'correct amount'
  );
  if v_result -> 'expense' ->> 'replaces_expense_id' <> v_a::text then raise exception 'B did not replace A'; end if;
  select updated_at into v_updated_at from public.expenses where id = v_b;
  v_result := public.replace_expense(
    v_owner, v_trip, v_b, v_updated_at, v_c, gen_random_uuid(), repeat('7',64), 'Taxi corrected again',
    130, 'transport', 'trip_fund', null, now(), '', null, 'second correction'
  );
  if v_result -> 'expense' ->> 'replaces_expense_id' <> v_b::text then raise exception 'C did not replace B'; end if;

  if (select count(*) from public.expenses where trip_id=v_trip and id in (v_a,v_b,v_c)) <> 3
     or (select deleted_at is null from public.expenses where id=v_a)
     or (select deleted_at is null from public.expenses where id=v_b)
     or (select receipt_path is null from public.expenses where id=v_a)
     or (select receipt_path is null from public.expenses where id=v_b) then
    raise exception 'replacement history or old receipt paths were not preserved';
  end if;
  v_denied := false;
  begin
    perform public.replace_expense(
      v_owner, v_trip, v_a, v_updated_at, gen_random_uuid(), gen_random_uuid(), repeat('8',64), 'branch',
      1, 'food', 'trip_fund', null, now(), '', null, 'should not branch'
    );
  exception when others then
    if sqlerrm = 'EXPENSE_CONFLICT' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'expense parent accepted a second replacement'; end if;
  v_bad_id := gen_random_uuid();
  v_denied := false;
  begin
    insert into public.expenses(
      id, trip_id, title, amount, category, payment_source, created_by, spent_at,
      replaces_expense_id, client_request_id, request_hash
    ) values (v_bad_id, v_trip, 'second child', 1, 'food', 'trip_fund', v_owner, now(),
      v_a, gen_random_uuid(), repeat('8',64));
  exception when unique_violation then v_denied := true;
  end;
  if not v_denied then raise exception 'database accepted a second replacement child'; end if;

  v_result := public.delete_expense(v_owner, v_trip, v_c, '  no longer needed  ');
  if v_result -> 'expense' ->> 'delete_reason' <> 'no longer needed'
     or v_result -> 'expense' ->> 'deleted_by' <> v_owner::text
     or v_result -> 'expense' ->> 'deleted_at' is null then
    raise exception 'soft delete audit fields were not saved';
  end if;
  select deleted_at, deleted_by, delete_reason into v_deleted_at, v_deleted_by, v_reason
  from public.expenses where id = v_c;
  v_denied := false;
  begin
    perform public.delete_expense(v_owner, v_trip, v_c, 'rewrite attempt');
  exception when others then
    if sqlerrm = 'EXPENSE_ALREADY_DELETED' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'repeat delete did not conflict'; end if;
  -- Authorization hides deleted-expense state from former members and outsiders.
  v_denied := false;
  begin
    perform public.delete_expense(v_former, v_trip, v_c, 'former member probe');
  exception when others then
    if sqlerrm = 'EXPENSE_FORBIDDEN' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'former member learned deleted expense state'; end if;
  v_denied := false;
  begin
    perform public.delete_expense(v_outsider, v_trip, v_c, 'outsider probe');
  exception when others then
    if sqlerrm = 'EXPENSE_FORBIDDEN' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'outsider learned deleted expense state'; end if;
  if (select deleted_at from public.expenses where id=v_c) is distinct from v_deleted_at
     or (select deleted_by from public.expenses where id=v_c) is distinct from v_deleted_by
     or (select delete_reason from public.expenses where id=v_c) is distinct from v_reason then
    raise exception 'repeat delete rewrote audit fields';
  end if;

  v_denied := false;
  begin
    perform public.delete_trip(v_owner, v_trip);
  exception when others then
    if sqlerrm = 'TRIP_HAS_EXPENSE_HISTORY' then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'trip with soft-deleted/superseded expense was hard-deleted'; end if;

  v_denied := false;
  begin
    delete from public.profiles where id = v_member;
  exception when foreign_key_violation then v_denied := true;
  end;
  if not v_denied then raise exception 'profile deletion removed expense history'; end if;
end;
$$;

reset role;

do $$
declare
  v_bucket_count integer;
begin
  if not (select relrowsecurity from pg_class where oid='public.expenses'::regclass) then
    raise exception 'expenses RLS is not enabled';
  end if;
  if has_table_privilege('anon', 'public.expenses', 'select')
     or has_table_privilege('authenticated', 'public.expenses', 'select')
     or has_table_privilege('anon', 'public.expenses', 'insert')
     or has_table_privilege('authenticated', 'public.expenses', 'insert') then
    raise exception 'browser role can access expense table directly';
  end if;
  if has_table_privilege('service_role', 'public.expenses', 'insert')
     or has_table_privilege('service_role', 'public.expenses', 'update')
     or has_table_privilege('service_role', 'public.expenses', 'delete')
     or not has_table_privilege('service_role', 'public.expenses', 'select') then
    raise exception 'service_role has direct expense write privileges';
  end if;
  if has_function_privilege('anon', 'public.create_expense(uuid,uuid,uuid,uuid,text,text,numeric,text,text,uuid,timestamptz,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.create_expense(uuid,uuid,uuid,uuid,text,text,numeric,text,text,uuid,timestamptz,text,text)', 'execute')
     or has_function_privilege('anon', 'public.replace_expense(uuid,uuid,uuid,timestamptz,uuid,uuid,text,text,numeric,text,text,uuid,timestamptz,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.delete_expense(uuid,uuid,uuid,text)', 'execute') then
    raise exception 'browser role can execute expense mutation RPC';
  end if;
  if not has_function_privilege('service_role', 'public.create_expense(uuid,uuid,uuid,uuid,text,text,numeric,text,text,uuid,timestamptz,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.replace_expense(uuid,uuid,uuid,timestamptz,uuid,uuid,text,text,numeric,text,text,uuid,timestamptz,text,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.delete_expense(uuid,uuid,uuid,text)', 'execute') then
    raise exception 'service_role cannot execute expense mutation RPC';
  end if;
  select count(*) into v_bucket_count from storage.buckets
  where id='expense-receipts' and public is false and file_size_limit=10485760
    and allowed_mime_types @> array['image/png','image/jpeg','image/webp','application/pdf']::text[];
  if v_bucket_count <> 1 then raise exception 'private expense receipt bucket limits are wrong'; end if;
  if not exists (
    select 1 from pg_proc
    where oid='public.create_expense(uuid,uuid,uuid,uuid,text,text,numeric,text,text,uuid,timestamptz,text,text)'::regprocedure
      and prosecdef and proconfig @> array['search_path=""']::text[]
  ) then
    raise exception 'create expense RPC security or search_path is wrong';
  end if;
  if not exists (
    select 1 from pg_proc
    where oid='public.replace_expense(uuid,uuid,uuid,timestamptz,uuid,uuid,text,text,numeric,text,text,uuid,timestamptz,text,text,text)'::regprocedure
      and prosecdef and proconfig @> array['search_path=""']::text[]
  ) or not exists (
    select 1 from pg_proc
    where oid='public.delete_expense(uuid,uuid,uuid,text)'::regprocedure
      and prosecdef and proconfig @> array['search_path=""']::text[]
  ) then
    raise exception 'expense mutation RPC security or search_path is wrong';
  end if;
  if not has_function_privilege('service_role', 'public.cleanup_m2_expense_e2e_fixture(uuid)', 'execute')
     or has_function_privilege('anon', 'public.cleanup_m2_expense_e2e_fixture(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.cleanup_m2_expense_e2e_fixture(uuid)', 'execute') then
    raise exception 'fixture cleanup privileges are wrong';
  end if;
end;
$$;

rollback;
