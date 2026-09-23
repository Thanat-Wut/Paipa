-- A commitment signature records a member's decision to go. Joining a trip
-- and choosing maybe/not_going do not require or retain a signature.

alter table public.trip_members
  add column commitment_signed_at timestamptz;

-- The previous M1 flow stored a signature on join. Preserve the commitment
-- for existing going rows that have a signature; unconfirmed rows become maybe.
update public.trip_members
set attendance = 'maybe', signature_path = null
where attendance = 'going' and signature_path is null;

update public.trip_members
set commitment_signed_at = joined_at
where attendance = 'going' and signature_path is not null;

update public.trip_members
set signature_path = null, commitment_signed_at = null
where attendance <> 'going';

alter table public.trip_members alter column attendance set default 'maybe';
alter table public.trip_members
  add constraint trip_members_commitment_check check (
    (attendance = 'going' and signature_path is not null and commitment_signed_at is not null)
    or
    (attendance in ('maybe', 'not_going') and signature_path is null and commitment_signed_at is null)
  );

-- Trip creators are members too, so their initial attendance must satisfy the
-- same commitment rule as every other member.
create or replace function public.create_trip(
  p_name text, p_description text, p_destination text,
  p_start_date date, p_end_date date, p_budget_per_person numeric,
  p_max_members integer
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_trip_id uuid;
  v_name text;
  v_description text;
  v_destination text;
begin
  if (select auth.uid()) is null then raise exception 'Login required'; end if;

  v_name := btrim(coalesce(p_name, ''));
  v_description := btrim(coalesce(p_description, ''));
  v_destination := btrim(coalesce(p_destination, ''));

  if char_length(v_name) not between 2 and 80
     or char_length(v_description) > 500
     or char_length(v_destination) > 120
     or p_start_date is null or p_end_date is null or p_end_date < p_start_date
     or p_budget_per_person is null or p_budget_per_person not between 0 and 1000000
     or p_max_members is null or p_max_members not between 2 and 100 then
    raise exception 'Invalid trip data';
  end if;

  insert into public.trips(
    owner_id, name, description, destination, start_date, end_date,
    budget_per_person, max_members
  )
  values (
    (select auth.uid()), v_name, v_description, v_destination,
    p_start_date, p_end_date, p_budget_per_person, p_max_members
  )
  returning id into v_trip_id;

  insert into public.trip_members(trip_id, user_id, display_name, role, attendance)
  select v_trip_id, id, display_name, 'owner', 'maybe'
  from public.profiles where id = (select auth.uid());

  return v_trip_id;
end;
$$;

-- Joining grants membership only; the member can record a commitment later.
drop function public.join_trip(text, text, text, text, text);
create function public.join_trip(p_code text, p_display_name text, p_avatar_type text, p_avatar_url text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_invite public.trip_invites%rowtype; v_trip public.trips%rowtype; v_count bigint;
begin
  if (select auth.uid()) is null then raise exception 'Login required'; end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 60
     or p_avatar_type not in ('emoji','image','gif') then
    raise exception 'Invalid member profile';
  end if;
  select * into v_invite from public.trip_invites where code = p_code for update;
  if not found or (v_invite.expires_at is not null and v_invite.expires_at <= now())
     or (v_invite.max_uses is not null and v_invite.usage_count >= v_invite.max_uses) then
    raise exception 'Invite is invalid or expired';
  end if;
  select * into v_trip from public.trips where id = v_invite.trip_id for update;
  if v_trip.status = 'archived' then raise exception 'Trip is archived'; end if;
  if exists(select 1 from public.trip_members where trip_id = v_trip.id and user_id = (select auth.uid())) then
    return v_trip.id;
  end if;
  select count(*) into v_count from public.trip_members where trip_id = v_trip.id;
  if v_count >= v_trip.max_members then raise exception 'Trip is full'; end if;
  insert into public.trip_members(trip_id, user_id, display_name, avatar_type, avatar_url, attendance)
  values (v_trip.id, (select auth.uid()), btrim(p_display_name), p_avatar_type, nullif(btrim(coalesce(p_avatar_url,'')),''), 'maybe');
  update public.trip_invites set usage_count = usage_count + 1 where id = v_invite.id;
  return v_trip.id;
end;
$$;

create or replace function public.update_member_profile(p_trip_id uuid, p_display_name text, p_avatar_type text, p_avatar_url text, p_signature_path text, p_attendance text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_member public.trip_members%rowtype;
  v_signature_path text := nullif(btrim(coalesce(p_signature_path, '')), '');
  v_commitment_signed_at timestamptz;
begin
  if (select auth.uid()) is null then raise exception 'Login required'; end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 60
     or p_avatar_type not in ('emoji','image','gif')
     or p_attendance not in ('going','maybe','not_going') then
    raise exception 'Invalid member profile';
  end if;

  select * into v_member from public.trip_members
  where trip_id = p_trip_id and user_id = (select auth.uid()) for update;
  if not found then raise exception 'Not a trip member'; end if;

  if p_attendance = 'going' then
    if v_signature_path is null then raise exception 'Valid signature required'; end if;
    if split_part(v_signature_path, '/', 1) <> (select auth.uid())::text
       or not exists(select 1 from storage.objects where bucket_id = 'signatures' and name = v_signature_path) then
      raise exception 'Invalid signature path';
    end if;
    v_commitment_signed_at := case
      when v_member.attendance = 'going' and v_member.signature_path = v_signature_path
        then v_member.commitment_signed_at
      else now()
    end;
  else
    v_signature_path := null;
    v_commitment_signed_at := null;
  end if;

  update public.trip_members set
    display_name = btrim(p_display_name),
    avatar_type = p_avatar_type,
    avatar_url = nullif(btrim(coalesce(p_avatar_url,'')),''),
    signature_path = v_signature_path,
    commitment_signed_at = v_commitment_signed_at,
    attendance = p_attendance
  where id = v_member.id;
end;
$$;

revoke all on function public.join_trip(text, text, text, text) from public;
revoke all on function public.join_trip(text, text, text, text) from anon;
grant execute on function public.join_trip(text, text, text, text) to authenticated;
