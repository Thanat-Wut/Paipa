-- Run against a disposable or empty Paipa schema. All fixture rows are rolled back.
begin;

insert into auth.users(id, email, aud, role, created_at, updated_at)
values
  ('20000000-0000-0000-0000-000000000001', 'paipa-m1-owner@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('20000000-0000-0000-0000-000000000002', 'paipa-m1-member@example.invalid', 'authenticated', 'authenticated', now(), now());

set local role authenticated;

do $$
declare
  v_trip uuid;
  v_joined uuid;
  v_count integer;
  v_rejected boolean;
  v_signature text := '20000000-0000-0000-0000-000000000002/m1-test.png';
begin
  perform set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
  v_trip := public.create_trip('Pattaya 2026', '', 'Pattaya', '2026-11-01', '2026-11-03', 3500, 8);
  if not exists(select 1 from public.trip_members where trip_id=v_trip and role='owner') then
    raise exception 'owner membership not created';
  end if;
  insert into public.trip_invites(trip_id, code, created_by, expires_at)
  values (v_trip, 'M1TestInvite', '20000000-0000-0000-0000-000000000001', now() + interval '1 day');

  perform set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
  select count(*) into v_count from public.trips where id=v_trip;
  if v_count <> 0 then raise exception 'nonmember can read trip'; end if;
  if not exists(select 1 from public.preview_invite('M1TestInvite')) then
    raise exception 'invite preview unavailable to nonmember';
  end if;
  v_rejected := false;
  begin
    perform public.join_trip('M1TestInvite', 'Beam', 'emoji', '', '');
  exception when raise_exception then
    if sqlerrm = 'Valid signature required' then v_rejected := true; else raise; end if;
  end;
  if not v_rejected then raise exception 'unsigned member joined'; end if;

  insert into storage.objects(bucket_id, name, owner_id) values ('signatures', v_signature, '20000000-0000-0000-0000-000000000002');
  v_joined := public.join_trip('M1TestInvite', 'Beam', 'emoji', '', v_signature);
  if v_joined <> v_trip then raise exception 'join returned wrong trip'; end if;
  select count(*) into v_count from public.trip_members where trip_id=v_trip;
  if v_count <> 2 then raise exception 'member not visible after join'; end if;
  v_joined := public.join_trip('M1TestInvite', 'Beam', 'emoji', '', v_signature);
  select usage_count into v_count from public.trip_invites where code='M1TestInvite';
  if v_joined <> v_trip or v_count <> 1 then raise exception 'duplicate join consumed invite'; end if;

  v_rejected := false;
  begin
    perform public.update_member_profile(v_trip, 'Beam', 'emoji', '', '20000000-0000-0000-0000-000000000002/missing.png', 'going');
  exception when raise_exception then
    if sqlerrm = 'Invalid signature path' then v_rejected := true; else raise; end if;
  end;
  if not v_rejected then raise exception 'missing signature accepted'; end if;

  perform set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
  select count(*) into v_count from public.trip_members where trip_id=v_trip;
  if v_count <> 2 then raise exception 'owner cannot see joined member'; end if;
  v_rejected := false;
  begin
    update public.trips set max_members=1 where id=v_trip;
  exception when raise_exception then
    if sqlerrm = 'Maximum members cannot be below the current roster' then v_rejected := true; else raise; end if;
  end;
  if not v_rejected then raise exception 'capacity dropped below roster'; end if;
end;
$$;

rollback;
