-- Run against a disposable Paipa database after M2.1 migrations.
-- All fixture rows and RPC mutations roll back at the end.
begin;

insert into public.profiles(id, display_name) values
  ('30000000-0000-0000-0000-000000000001', 'M2 Owner'),
  ('30000000-0000-0000-0000-000000000002', 'M2 Member');

set local role service_role;

do $$
declare
  v_owner constant uuid := '30000000-0000-0000-0000-000000000001';
  v_member constant uuid := '30000000-0000-0000-0000-000000000002';
  v_trip uuid;
  v_invite uuid;
  v_owner_contribution uuid;
  v_member_contribution uuid;
  v_rejected boolean;
begin
  v_trip := public.create_trip(v_owner, 'M2 Account Test', '', 'Bangkok', '2026-12-01', '2026-12-02', 3500, 4);

  if (select currency from public.trips where id = v_trip) <> 'THB' then
    raise exception 'new trip currency must default to THB';
  end if;

  v_rejected := false;
  begin
    update public.trips set currency = 'USD' where id = v_trip;
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'trip accepted a non-THB currency'; end if;

  select id into v_owner_contribution
  from public.contributions
  where trip_id = v_trip and contributor_id = v_owner;
  if v_owner_contribution is null then
    raise exception 'create_trip did not create the owner contribution';
  end if;

  -- Exercise the migration's membership backfill statement and its idempotency.
  delete from public.contributions where id = v_owner_contribution;
  insert into public.contributions(trip_id, contributor_id)
  select trip_id, user_id from public.trip_members where trip_id = v_trip
  on conflict (trip_id, contributor_id) do nothing;
  select id into v_owner_contribution
  from public.contributions
  where trip_id = v_trip and contributor_id = v_owner;
  if v_owner_contribution is null then
    raise exception 'membership backfill did not restore its contribution';
  end if;

  v_invite := public.create_invite(v_owner, v_trip, 'M2ContributionTest', now() + interval '1 day');
  if v_invite is null then raise exception 'could not create invite fixture'; end if;

  perform public.join_trip(v_member, 'M2ContributionTest', 'M2 Member', 'emoji', '');
  if not exists (
    select 1 from public.trip_members
    where trip_id = v_trip and user_id = v_member and attendance = 'maybe'
      and signature_path is null and commitment_signed_at is null
  ) then
    raise exception 'M1 unsigned join must still create a maybe member';
  end if;

  select id into v_member_contribution
  from public.contributions
  where trip_id = v_trip and contributor_id = v_member;
  if v_member_contribution is null then
    raise exception 'join_trip did not create the member contribution';
  end if;

  perform public.leave_trip(v_member, v_trip);
  if exists (select 1 from public.trip_members where trip_id = v_trip and user_id = v_member) then
    raise exception 'leaving did not remove current membership';
  end if;
  if not exists (
    select 1 from public.contributions where id = v_member_contribution
      and trip_id = v_trip and contributor_id = v_member
  ) then
    raise exception 'leaving removed the permanent contribution';
  end if;

  perform public.join_trip(v_member, 'M2ContributionTest', 'M2 Member', 'emoji', '');
  if (select id from public.contributions where trip_id = v_trip and contributor_id = v_member)
     <> v_member_contribution then
    raise exception 'rejoin created a replacement contribution instead of reusing the account';
  end if;
  if (select count(*) from public.contributions where trip_id = v_trip and contributor_id = v_member) <> 1 then
    raise exception 'rejoin created duplicate contributions';
  end if;

  perform public.delete_trip(v_owner, v_trip);
  if exists (select 1 from public.contributions where trip_id = v_trip) then
    raise exception 'contributions for a ledger-free deleted trip did not cascade';
  end if;
end;
$$;

reset role;

do $$
begin
  if not (
    select relrowsecurity from pg_class where oid = 'public.contributions'::regclass
  ) then
    raise exception 'contributions must have row-level security enabled';
  end if;
  if has_table_privilege('anon', 'public.contributions', 'select')
     or has_table_privilege('authenticated', 'public.contributions', 'select') then
    raise exception 'browser roles must not have direct contribution access';
  end if;
  if not has_table_privilege('service_role', 'public.contributions', 'select,insert,update,delete') then
    raise exception 'server service_role must access contributions';
  end if;
end;
$$;

rollback;
