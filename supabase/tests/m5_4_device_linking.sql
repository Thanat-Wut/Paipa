-- M5.4 cross-device identity linking acceptance checks.
-- Fixtures are seeded/read as postgres, while every redemption call is made
-- after SET LOCAL ROLE service_role. The whole suite rolls back.
begin;

create temp table m5_4_context (payload jsonb not null);
grant select on m5_4_context to service_role;

do $$
declare
  v_primary uuid := gen_random_uuid();
  v_secondary uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_trip uuid := gen_random_uuid();
  v_signed_trip uuid := gen_random_uuid();
  v_owner_trip uuid := gen_random_uuid();
  v_archived_trip uuid := gen_random_uuid();
  v_orphan_trip uuid := gen_random_uuid();
  v_signed_member_id uuid;
  v_passive_member_id uuid;
  v_note uuid := gen_random_uuid();
  v_comment uuid := gen_random_uuid();
  v_poll uuid := gen_random_uuid();
  v_option uuid := gen_random_uuid();
  v_plan uuid := gen_random_uuid();
  v_activity uuid := gen_random_uuid();
  v_payment uuid := gen_random_uuid();
  v_expense uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_storage_name text;
  v_payment_storage_name text;
  v_expense_receipt_name text;
  v_before jsonb;
begin
  if to_regclass('public.device_link_tokens') is null then raise exception 'device_link_tokens table missing'; end if;
  if to_regprocedure('public.redeem_device_link(uuid,text)') is null then raise exception 'redeem_device_link function missing'; end if;
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.device_link_tokens'::pg_catalog.regclass) then
    raise exception 'device_link_tokens RLS disabled';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    left join pg_catalog.pg_roles r on r.oid = a.grantee
    where c.oid = 'public.device_link_tokens'::pg_catalog.regclass
      and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))
  ) then
    raise exception 'device_link_tokens exposed to browser roles';
  end if;
  if not has_table_privilege('service_role', 'public.device_link_tokens', 'select')
     or not has_table_privilege('service_role', 'public.device_link_tokens', 'insert')
     or not has_table_privilege('service_role', 'public.device_link_tokens', 'update')
     or not has_table_privilege('service_role', 'public.device_link_tokens', 'delete') then
    raise exception 'service_role token-table grants are incomplete';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    left join pg_catalog.pg_roles r on r.oid = a.grantee
    where p.oid = 'public.redeem_device_link(uuid,text)'::pg_catalog.regprocedure
      and a.privilege_type = 'EXECUTE'
      and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))
  )
     or has_function_privilege('anon', 'public.redeem_device_link(uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.redeem_device_link(uuid,text)', 'execute')
     or not has_function_privilege('service_role', 'public.redeem_device_link(uuid,text)', 'execute') then
    raise exception 'redeem_device_link execute grants are not service_role-only';
  end if;
  if position('FOR UPDATE' in upper(pg_get_functiondef('public.redeem_device_link(uuid,text)'::pg_catalog.regprocedure))) = 0 then
    raise exception 'redeem_device_link must lock the token row';
  end if;

  if exists (
    select 1 from pg_catalog.pg_constraint
    where confrelid = 'public.trip_members'::pg_catalog.regclass and contype = 'f'
  ) then
    raise exception 'trip_members has an inbound FK; cleanup must remain disabled';
  end if;
  if exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.trip_members'::pg_catalog.regclass and not tgisinternal
  ) then
    raise exception 'trip_members has a trigger; cleanup must remain disabled';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.trip_members'::pg_catalog.regclass
      and confrelid = 'public.trips'::pg_catalog.regclass
      and contype = 'f' and confdeltype = 'c'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.trip_members'::pg_catalog.regclass
      and confrelid = 'public.profiles'::pg_catalog.regclass
      and contype = 'f' and confdeltype = 'c'
  ) then
    raise exception 'trip_members outbound FK graph changed';
  end if;

  insert into public.profiles(id, display_name) values
    (v_primary, 'M5.4 Primary'), (v_secondary, 'M5.4 Secondary'), (v_other, 'M5.4 Other');
  insert into public.trips(id, owner_id, name, start_date, end_date, status) values
    (v_trip, v_primary, 'M5.4 active', current_date, current_date + 1, 'planning'),
    (v_signed_trip, v_primary, 'M5.4 signed', current_date, current_date + 1, 'planning'),
    (v_owner_trip, v_primary, 'M5.4 owner', current_date, current_date + 1, 'planning'),
    (v_archived_trip, v_primary, 'M5.4 archived', current_date, current_date + 1, 'archived'),
    (v_orphan_trip, v_secondary, 'M5.4 secondary only', current_date, current_date + 1, 'planning');
  insert into public.trip_members(trip_id, user_id, display_name, role, attendance) values
    (v_trip, v_primary, 'M5.4 Primary', 'owner', 'maybe'),
    (v_trip, v_secondary, 'M5.4 Secondary', 'member', 'maybe'),
    (v_signed_trip, v_primary, 'M5.4 Primary', 'owner', 'maybe'),
    (v_owner_trip, v_primary, 'M5.4 Primary', 'owner', 'maybe'),
    (v_owner_trip, v_secondary, 'M5.4 Secondary owner', 'owner', 'maybe'),
    (v_archived_trip, v_primary, 'M5.4 Primary', 'owner', 'maybe'),
    (v_archived_trip, v_secondary, 'M5.4 Secondary', 'member', 'maybe'),
    (v_orphan_trip, v_secondary, 'M5.4 Secondary', 'owner', 'maybe');
  select id into v_passive_member_id
  from public.trip_members
  where trip_id = v_trip and user_id = v_secondary;
  insert into public.trip_members(trip_id, user_id, display_name, role, attendance, signature_path, commitment_signed_at)
  values (v_signed_trip, v_secondary, 'M5.4 Signed', 'member', 'going', v_secondary::text || '/m5-4.png', now())
  returning id into v_signed_member_id;

  insert into public.contributions(trip_id, contributor_id) values
    (v_trip, v_primary), (v_trip, v_secondary);
  insert into public.payment_submissions(
    id, trip_id, contributor_id, client_request_id, request_hash, amount,
    payment_method, payment_occurred_at, proof_path, note
  ) values (
    v_payment, v_trip, v_secondary, v_request, repeat('a', 64), 100,
    'cash', now(), v_trip::text || '/' || v_secondary::text || '/m5-4-payment.png', 'M5.4 preserved payment'
  );
  insert into public.expenses(
    id, trip_id, title, amount, category, payment_source, created_by,
    spent_at, client_request_id, request_hash
  ) values (
    v_expense, v_trip, 'M5.4 preserved expense', 100, 'food', 'trip_fund', v_secondary,
    now(), gen_random_uuid(), repeat('b', 64)
  );
  insert into public.board_notes(id, trip_id, author_id, title, content)
  values (v_note, v_trip, v_secondary, 'M5.4 note', 'preserve');
  insert into public.board_note_comments(id, note_id, author_id, content)
  values (v_comment, v_note, v_secondary, 'M5.4 comment');
  insert into public.board_note_likes(note_id, profile_id) values (v_note, v_secondary);
  insert into public.chat_messages(trip_id, author_id, content, note_id)
  values (v_trip, v_secondary, 'M5.4 chat', v_note);
  insert into public.polls(id, trip_id, created_by, question)
  values (v_poll, v_trip, v_secondary, 'M5.4 poll');
  insert into public.poll_options(id, poll_id, label, sort_order)
  values (v_option, v_poll, 'M5.4 option', 0);
  insert into public.poll_votes(poll_id, option_id, profile_id)
  values (v_poll, v_option, v_secondary);
  insert into public.trip_plan_items(id, trip_id, day_date, created_by, title)
  values (v_plan, v_trip, current_date, v_secondary, 'M5.4 plan');
  insert into public.trip_activities(id, trip_id, actor_id, type, entity_type, entity_id)
  values (v_activity, v_trip, v_secondary, 'board_note_created', 'board_note', v_note);
  v_storage_name := v_secondary::text || '/m5-4.png';
  insert into storage.objects(bucket_id, name, owner_id) values ('signatures', v_storage_name, v_secondary::text);
  v_payment_storage_name := v_trip::text || '/' || v_secondary::text || '/m5-4-payment.png';
  insert into storage.objects(bucket_id, name, owner_id) values ('payment-proofs', v_payment_storage_name, v_secondary::text);
  v_expense_receipt_name := v_trip::text || '/' || v_expense::text || '/550e8400-e29b-41d4-a716-446655440000.png';
  update public.expenses set receipt_path = v_expense_receipt_name where id = v_expense;
  insert into storage.objects(bucket_id, name, owner_id) values ('expense-receipts', v_expense_receipt_name, v_secondary::text);

  v_before := jsonb_build_object(
    'profiles', (select jsonb_agg(to_jsonb(p) order by p.id) from public.profiles p where p.id in (v_primary, v_secondary, v_other)),
    'trips', (select jsonb_agg(to_jsonb(t) order by t.id) from public.trips t where t.id in (v_trip, v_signed_trip, v_owner_trip, v_archived_trip, v_orphan_trip)),
    'trip_members', (select jsonb_agg(to_jsonb(m) order by m.id) from public.trip_members m where m.id <> v_passive_member_id and m.trip_id in (v_trip, v_signed_trip, v_owner_trip, v_archived_trip, v_orphan_trip)),
    'contributions', (select jsonb_agg(to_jsonb(x) order by x.id) from public.contributions x where x.trip_id = v_trip),
    'payments', (select jsonb_agg(to_jsonb(x) order by x.id) from public.payment_submissions x where x.trip_id = v_trip),
    'expenses', (select jsonb_agg(to_jsonb(x) order by x.id) from public.expenses x where x.trip_id = v_trip),
    'board_notes', (select jsonb_agg(to_jsonb(x) order by x.id) from public.board_notes x where x.trip_id = v_trip),
    'board_comments', (select jsonb_agg(to_jsonb(x) order by x.id) from public.board_note_comments x join public.board_notes n on n.id = x.note_id where n.trip_id = v_trip),
    'board_likes', (select jsonb_agg(to_jsonb(x) order by x.note_id, x.profile_id) from public.board_note_likes x join public.board_notes n on n.id = x.note_id where n.trip_id = v_trip),
    'chat', (select jsonb_agg(to_jsonb(x) order by x.id) from public.chat_messages x where x.trip_id = v_trip),
    'polls', (select jsonb_agg(to_jsonb(x) order by x.id) from public.polls x where x.trip_id = v_trip),
    'poll_options', (select jsonb_agg(to_jsonb(x) order by x.id) from public.poll_options x where x.poll_id = v_poll),
    'poll_votes', (select jsonb_agg(to_jsonb(x) order by x.profile_id) from public.poll_votes x where x.poll_id = v_poll),
    'plan', (select jsonb_agg(to_jsonb(x) order by x.id) from public.trip_plan_items x where x.trip_id = v_trip),
    'activity', (select jsonb_agg(to_jsonb(x) order by x.id) from public.trip_activities x where x.trip_id = v_trip),
    'storage', (select jsonb_agg(to_jsonb(x) order by x.bucket_id, x.name) from storage.objects x where (x.bucket_id, x.name) in (('signatures', v_storage_name), ('payment-proofs', v_payment_storage_name), ('expense-receipts', v_expense_receipt_name)))
  );

  insert into m5_4_context(payload) values (jsonb_build_object(
    'primary', v_primary, 'secondary', v_secondary, 'other', v_other,
    'trip', v_trip, 'signed_trip', v_signed_trip, 'owner_trip', v_owner_trip,
    'archived_trip', v_archived_trip, 'orphan_trip', v_orphan_trip,
    'signed_member', v_signed_member_id, 'passive_member', v_passive_member_id,
    'poll', v_poll, 'before', v_before, 'storage_name', v_storage_name,
    'payment_storage_name', v_payment_storage_name, 'expense_receipt_name', v_expense_receipt_name
  ));
  insert into public.device_link_tokens(profile_id, token_hash, expires_at)
  values (v_primary, repeat('a', 64), now() + interval '10 minutes');
end;
$$;

-- The RPC is intentionally invoked as service_role. It is SECURITY DEFINER,
-- so its table work still runs with the function owner privileges.
set local role service_role;
do $$
declare
  c jsonb;
  v_primary uuid;
  v_secondary uuid;
  v_other uuid;
  v_result jsonb;
  v_rejected boolean;
begin
  select payload into c from pg_temp.m5_4_context limit 1;
  v_primary := (c->>'primary')::uuid;
  v_secondary := (c->>'secondary')::uuid;
  v_other := (c->>'other')::uuid;

  v_result := public.redeem_device_link(v_secondary, repeat('a', 64));
  if v_result->>'profile_id' <> v_primary::text or (v_result->>'cleaned_count')::integer <> 1 then
    raise exception 'valid redemption result is incorrect: %', v_result;
  end if;

  v_rejected := false;
  begin perform public.redeem_device_link(v_secondary, repeat('a', 64));
  exception when others then v_rejected := true; end;
  if not v_rejected then raise exception 'used token redeemed twice'; end if;

  insert into public.device_link_tokens(profile_id, token_hash, expires_at) values
    (v_primary, repeat('c', 64), now() + interval '10 minutes'),
    (v_primary, repeat('d', 64), now() + interval '10 minutes');
  v_result := public.redeem_device_link(null, repeat('c', 64));
  if v_result->>'profile_id' <> v_primary::text or (v_result->>'cleaned_count')::integer <> 0 then
    raise exception 'fresh-browser redemption result is incorrect: %', v_result;
  end if;
  v_result := public.redeem_device_link(v_other, repeat('d', 64));
  if v_result->>'profile_id' <> v_primary::text then
    raise exception 'valid code did not work for a different secondary identity';
  end if;

  insert into public.device_link_tokens(profile_id, token_hash, expires_at)
  values (v_primary, repeat('b', 64), now() - interval '1 second');
  v_rejected := false;
  begin perform public.redeem_device_link(null, repeat('b', 64));
  exception when others then v_rejected := true; end;
  if not v_rejected then raise exception 'expired token redeemed'; end if;

  v_rejected := false;
  begin perform public.redeem_device_link(null, repeat('e', 64));
  exception when others then v_rejected := true; end;
  if not v_rejected then raise exception 'wrong token redeemed'; end if;

  v_rejected := false;
  begin perform public.redeem_device_link(null, 'not-a-sha256-hash');
  exception when others then v_rejected := true; end;
  if not v_rejected then raise exception 'malformed token redeemed'; end if;

  -- A caller-side failure after a successful RPC must roll back consumption.
  insert into public.device_link_tokens(profile_id, token_hash, expires_at)
  values (v_primary, repeat('f', 64), now() + interval '10 minutes');
  begin
    perform public.redeem_device_link(v_other, repeat('f', 64));
    raise exception 'M5.4_INTENTIONAL_ROLLBACK';
  exception when others then
    if sqlerrm <> 'M5.4_INTENTIONAL_ROLLBACK' then raise; end if;
  end;
  if (select used_at from public.device_link_tokens where token_hash = repeat('f', 64)) is not null then
    raise exception 'token consumption was not rolled back after caller failure';
  end if;
end;
$$;

set local role postgres;
do $$
declare
  c jsonb;
  v_primary uuid;
  v_secondary uuid;
  v_trip uuid;
  v_signed_trip uuid;
  v_owner_trip uuid;
  v_archived_trip uuid;
  v_orphan_trip uuid;
  v_signed_member_id uuid;
  v_passive_member_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  select payload into c from pg_temp.m5_4_context limit 1;
  v_primary := (c->>'primary')::uuid;
  v_secondary := (c->>'secondary')::uuid;
  v_trip := (c->>'trip')::uuid;
  v_signed_trip := (c->>'signed_trip')::uuid;
  v_owner_trip := (c->>'owner_trip')::uuid;
  v_archived_trip := (c->>'archived_trip')::uuid;
  v_orphan_trip := (c->>'orphan_trip')::uuid;
  v_signed_member_id := (c->>'signed_member')::uuid;
  v_passive_member_id := (c->>'passive_member')::uuid;
  v_before := c->'before';

  if exists (select 1 from public.trip_members where id = v_passive_member_id) then
    raise exception 'passive duplicate membership was not removed';
  end if;
  if not exists (select 1 from public.trip_members where id = v_signed_member_id) then
    raise exception 'meaningful signed membership was removed';
  end if;
  if not exists (select 1 from public.trip_members where trip_id = v_owner_trip and user_id = v_secondary and role = 'owner') then
    raise exception 'owner membership was removed';
  end if;
  if not exists (select 1 from public.trip_members where trip_id = v_archived_trip and user_id = v_secondary) then
    raise exception 'archived duplicate membership was removed';
  end if;
  if not exists (select 1 from public.trip_members where trip_id = v_orphan_trip and user_id = v_secondary) then
    raise exception 'secondary-only membership was removed';
  end if;
  if (select owner_id from public.trips where id = v_trip) <> v_primary then
    raise exception 'Trip ownership changed during linking';
  end if;
  if not exists (select 1 from public.profiles where id = v_primary and display_name = 'M5.4 Primary')
     or not exists (select 1 from public.profiles where id = v_secondary and display_name = 'M5.4 Secondary') then
    raise exception 'profile history changed during linking';
  end if;
  if (select used_at from public.device_link_tokens where token_hash = repeat('a', 64)) is null then
    raise exception 'successful redemption did not consume the token';
  end if;
  if (select count(*) from public.device_link_tokens where token_hash in (repeat('c', 64), repeat('d', 64)) and used_at is null) <> 0 then
    raise exception 'multiple active codes did not redeem independently';
  end if;
  if (select used_at from public.device_link_tokens where token_hash = repeat('b', 64)) is not null then
    raise exception 'expired token was consumed';
  end if;

  v_after := jsonb_build_object(
    'profiles', (select jsonb_agg(to_jsonb(p) order by p.id) from public.profiles p where p.id in ((c->>'primary')::uuid, (c->>'secondary')::uuid, (c->>'other')::uuid)),
    'trips', (select jsonb_agg(to_jsonb(t) order by t.id) from public.trips t where t.id in (v_trip, v_signed_trip, v_owner_trip, v_archived_trip, v_orphan_trip)),
    'trip_members', (select jsonb_agg(to_jsonb(m) order by m.id) from public.trip_members m where m.id <> v_passive_member_id and m.trip_id in (v_trip, v_signed_trip, v_owner_trip, v_archived_trip, v_orphan_trip)),
    'contributions', (select jsonb_agg(to_jsonb(x) order by x.id) from public.contributions x where x.trip_id = v_trip),
    'payments', (select jsonb_agg(to_jsonb(x) order by x.id) from public.payment_submissions x where x.trip_id = v_trip),
    'expenses', (select jsonb_agg(to_jsonb(x) order by x.id) from public.expenses x where x.trip_id = v_trip),
    'board_notes', (select jsonb_agg(to_jsonb(x) order by x.id) from public.board_notes x where x.trip_id = v_trip),
    'board_comments', (select jsonb_agg(to_jsonb(x) order by x.id) from public.board_note_comments x join public.board_notes n on n.id = x.note_id where n.trip_id = v_trip),
    'board_likes', (select jsonb_agg(to_jsonb(x) order by x.note_id, x.profile_id) from public.board_note_likes x join public.board_notes n on n.id = x.note_id where n.trip_id = v_trip),
    'chat', (select jsonb_agg(to_jsonb(x) order by x.id) from public.chat_messages x where x.trip_id = v_trip),
    'polls', (select jsonb_agg(to_jsonb(x) order by x.id) from public.polls x where x.trip_id = v_trip),
    'poll_options', (select jsonb_agg(to_jsonb(x) order by x.id) from public.poll_options x where x.poll_id = (c->>'poll')::uuid),
    'poll_votes', (select jsonb_agg(to_jsonb(x) order by x.profile_id) from public.poll_votes x where x.poll_id = (c->>'poll')::uuid),
    'plan', (select jsonb_agg(to_jsonb(x) order by x.id) from public.trip_plan_items x where x.trip_id = v_trip),
    'activity', (select jsonb_agg(to_jsonb(x) order by x.id) from public.trip_activities x where x.trip_id = v_trip),
    'storage', (select jsonb_agg(to_jsonb(x) order by x.bucket_id, x.name) from storage.objects x where (x.bucket_id, x.name) in (('signatures', c->>'storage_name'), ('payment-proofs', c->>'payment_storage_name'), ('expense-receipts', c->>'expense_receipt_name')))
  );
  if v_before <> v_after then raise exception 'historical data changed: before %, after %', v_before, v_after; end if;
end;
$$;

rollback;
