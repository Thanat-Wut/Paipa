-- Run after the local identity migration against a disposable Paipa schema.
-- All fixture rows and the test Storage object roll back at the end.
begin;

insert into public.profiles(id, display_name) values
  ('20000000-0000-0000-0000-000000000001', 'Same Name'),
  ('20000000-0000-0000-0000-000000000002', 'Same Name'),
  ('20000000-0000-0000-0000-000000000003', 'Same Name'),
  ('20000000-0000-0000-0000-000000000004', 'Fourth');

set local role service_role;

do $$
declare
  v_owner constant uuid := '20000000-0000-0000-0000-000000000001';
  v_member constant uuid := '20000000-0000-0000-0000-000000000002';
  v_other constant uuid := '20000000-0000-0000-0000-000000000003';
  v_fourth constant uuid := '20000000-0000-0000-0000-000000000004';
  v_trip uuid;
  v_invite uuid;
  v_joined uuid;
  v_old_signature text;
  v_signature text := '20000000-0000-0000-0000-000000000002/m1-test.png';
  v_usage integer;
  v_rejected boolean;
begin
  if (select count(distinct id) from public.profiles where display_name = 'Same Name') <> 3 then
    raise exception 'duplicate display names must remain separate UUID profiles';
  end if;

  v_trip := public.create_trip(v_owner, 'Pattaya 2026', '', 'Pattaya', '2026-11-01', '2026-11-03', 3500, 3);
  if not exists(select 1 from public.trips where id=v_trip and owner_id=v_owner) then
    raise exception 'trip owner UUID was not saved';
  end if;
  if not exists(select 1 from public.trip_members where trip_id=v_trip and user_id=v_owner and role='owner' and attendance='maybe' and signature_path is null and commitment_signed_at is null) then
    raise exception 'owner membership must start as maybe without a signature';
  end if;

  v_rejected := false;
  begin
    perform public.create_trip('20000000-0000-0000-0000-000000000099', 'Forged', '', '', '2026-11-01', '2026-11-03', 0, 3);
  exception when raise_exception then
    if sqlerrm = 'Profile not found' then v_rejected := true; else raise; end if;
  end;
  if not v_rejected then raise exception 'trip created for unknown profile UUID'; end if;

  v_invite := public.create_invite(v_owner, v_trip, 'M1LocalIdentity', now() + interval '1 day');
  if not exists(select 1 from public.trip_invites where id=v_invite and created_by=v_owner) then
    raise exception 'invite creator UUID was not saved';
  end if;

  v_rejected := false;
  begin
    perform public.create_invite(v_member, v_trip, 'M1NonOwner', now() + interval '1 day');
  exception when raise_exception then
    if sqlerrm = 'Trip owner required' then v_rejected := true; else raise; end if;
  end;
  if not v_rejected then raise exception 'non-owner created an invite'; end if;

  if not exists(select 1 from public.preview_invite('M1LocalIdentity')) then
    raise exception 'invite preview must be available before identity bootstrap';
  end if;

  v_joined := public.join_trip(v_member, 'M1LocalIdentity', 'Member', 'emoji', '');
  if v_joined <> v_trip then raise exception 'join returned the wrong trip'; end if;
  if not exists(select 1 from public.trip_members where trip_id=v_trip and user_id=v_member and attendance='maybe' and signature_path is null and commitment_signed_at is null) then
    raise exception 'unsigned join must create a maybe member without commitment data';
  end if;
  v_usage := (select usage_count from public.trip_invites where id=v_invite);
  perform public.join_trip(v_member, 'M1LocalIdentity', 'Member', 'emoji', '');
  if (select usage_count from public.trip_invites where id=v_invite) <> v_usage then
    raise exception 'duplicate join consumed another invite use';
  end if;

  v_rejected := false;
  begin
    perform public.update_member_profile(v_member, v_trip, 'Member', 'emoji', '', '', 'going');
  exception when raise_exception then
    if sqlerrm = 'Valid signature required' then v_rejected := true; else raise; end if;
  end;
  if not v_rejected then raise exception 'Maybe to Going accepted without signature'; end if;

  insert into storage.objects(bucket_id, name, owner_id)
  values ('signatures', v_signature, v_member::text);
  perform public.update_member_profile(v_member, v_trip, 'Member', 'emoji', '', v_signature, 'going');
  if not exists(select 1 from public.trip_members where trip_id=v_trip and user_id=v_member and attendance='going' and signature_path=v_signature and commitment_signed_at is not null) then
    raise exception 'signed Going did not record the signature and timestamp';
  end if;

  v_rejected := false;
  begin
    perform public.update_member_profile(v_other, v_trip, 'Other', 'emoji', '', v_signature, 'going');
  exception when raise_exception then
    if sqlerrm = 'Not a trip member' then v_rejected := true; else raise; end if;
  end;
  if not v_rejected then raise exception 'unrelated actor updated the member commitment'; end if;

  v_old_signature := public.update_member_profile(v_member, v_trip, 'Member', 'emoji', '', '', 'maybe');
  if v_old_signature <> v_signature then raise exception 'Going to Maybe did not return the object path for cleanup'; end if;
  if not exists(select 1 from public.trip_members where trip_id=v_trip and user_id=v_member and attendance='maybe' and signature_path is null and commitment_signed_at is null) then
    raise exception 'Going to Maybe did not clear active commitment fields';
  end if;

  v_rejected := false;
  begin
    perform public.update_member_profile(v_member, v_trip, 'Member', 'emoji', '', '', 'going');
  exception when raise_exception then
    if sqlerrm = 'Valid signature required' then v_rejected := true; else raise; end if;
  end;
  if not v_rejected then raise exception 'Maybe to Going accepted without signature'; end if;
  perform public.update_member_profile(v_member, v_trip, 'Member', 'emoji', '', v_signature, 'going');
  v_old_signature := public.update_member_profile(v_member, v_trip, 'Member', 'emoji', '', '', 'not_going');
  if v_old_signature <> v_signature then raise exception 'Going to Not Going did not return the object path for cleanup'; end if;
  if not exists(select 1 from public.trip_members where trip_id=v_trip and user_id=v_member and attendance='not_going' and signature_path is null and commitment_signed_at is null) then
    raise exception 'Going to Not Going did not clear active commitment fields';
  end if;

  perform public.update_trip(v_owner, v_trip, 'Edited trip', 'Owner edit', 'Pattaya', '2026-11-01', '2026-11-03', 3500, 3);
  v_rejected := false;
  begin
    perform public.update_trip(v_member, v_trip, 'Forged edit', '', '', '2026-11-01', '2026-11-03', 0, 3);
  exception when raise_exception then
    if sqlerrm = 'Trip owner required' then v_rejected := true; else raise; end if;
  end;
  if not v_rejected then raise exception 'member updated owner trip settings'; end if;

  v_rejected := false;
  begin
    perform public.update_trip('20000000-0000-0000-0000-000000000099', v_trip, 'Unknown edit', '', '', '2026-11-01', '2026-11-03', 0, 3);
  exception when raise_exception then
    if sqlerrm = 'Trip owner required' then v_rejected := true; else raise; end if;
  end;
  if not v_rejected then raise exception 'random UUID updated an owner trip'; end if;

  v_joined := public.join_trip(v_other, 'M1LocalIdentity', 'Other', 'emoji', '');
  if v_joined <> v_trip then raise exception 'third member could not join'; end if;
  v_rejected := false;
  begin
    perform public.join_trip(v_fourth, 'M1LocalIdentity', 'Fourth', 'emoji', '');
  exception when raise_exception then
    if sqlerrm = 'Trip is full' then v_rejected := true; else raise; end if;
  end;
  if not v_rejected then raise exception 'member joined a full trip'; end if;

  perform public.archive_trip(v_owner, v_trip);
  if not exists(select 1 from public.trips where id=v_trip and status='archived') then
    raise exception 'owner could not archive their trip';
  end if;
  perform public.delete_trip(v_owner, v_trip);
  if exists(select 1 from public.trips where id=v_trip) then raise exception 'owner could not delete their trip'; end if;
end;
$$;

reset role;

do $$
begin
  if exists(
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and confrelid = 'auth.users'::regclass
  ) then raise exception 'profiles still depends on auth.users'; end if;
  if has_table_privilege('anon', 'public.trips', 'select')
     or has_table_privilege('authenticated', 'public.trips', 'select') then
    raise exception 'browser roles still have direct trip-table read access';
  end if;
  if exists(select 1 from pg_trigger where tgname='on_auth_user_created' and not tgisinternal) then
    raise exception 'Auth profile creation trigger still exists';
  end if;
end;
$$;

set local role anon;
do $$
begin
  if exists(select 1 from public.preview_invite('M1LocalIdentity')) then
    raise exception 'rolled-back invite remained visible';
  end if;
end;
$$;
reset role;

rollback;
