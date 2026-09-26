create table public.device_link_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index device_link_tokens_profile_active_idx
  on public.device_link_tokens(profile_id, expires_at)
  where used_at is null;

create index device_link_tokens_expiry_idx
  on public.device_link_tokens(expires_at)
  where used_at is null;

alter table public.device_link_tokens enable row level security;
revoke all on table public.device_link_tokens from public, anon, authenticated;
grant select, insert, update, delete on table public.device_link_tokens to service_role;

create or replace function public.redeem_device_link(
  p_secondary_profile_id uuid,
  p_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_token public.device_link_tokens%rowtype;
  v_primary public.profiles%rowtype;
  v_member_id uuid;
  v_trip_id uuid;
  v_cleaned_count integer := 0;
  v_retained_count integer := 0;
  v_cleanup_safe boolean := true;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'DEVICE_LINK_INVALID';
  end if;

  select * into v_token
  from public.device_link_tokens
  where token_hash = p_token_hash
  for update;
  if not found then raise exception 'DEVICE_LINK_INVALID'; end if;
  if v_token.used_at is not null then raise exception 'DEVICE_LINK_USED'; end if;
  if v_token.expires_at <= pg_catalog.clock_timestamp() then raise exception 'DEVICE_LINK_EXPIRED'; end if;

  select * into v_primary
  from public.profiles
  where id = v_token.profile_id;
  if not found then raise exception 'DEVICE_LINK_PROFILE_MISSING'; end if;

  if p_secondary_profile_id is not null and p_secondary_profile_id <> v_token.profile_id then
    if exists (
      select 1
      from pg_catalog.pg_constraint
      where confrelid = 'public.trip_members'::pg_catalog.regclass
        and contype = 'f'
    ) or exists (
      select 1
      from pg_catalog.pg_trigger
      where tgrelid = 'public.trip_members'::pg_catalog.regclass
        and not tgisinternal
    ) then
      v_cleanup_safe := false;
    end if;

    if v_cleanup_safe then
      for v_member_id, v_trip_id in
        select m.id, m.trip_id
        from public.trip_members m
        join public.trips t on t.id = m.trip_id
        where m.user_id = p_secondary_profile_id
          and m.role = 'member'
          and m.attendance = 'maybe'
          and m.signature_path is null
          and m.commitment_signed_at is null
          and t.status <> 'archived'
          and exists (
            select 1
            from public.trip_members primary_member
            where primary_member.trip_id = m.trip_id
              and primary_member.user_id = v_primary.id
          )
        order by m.id
        for update of m
      loop
        delete from public.trip_members where id = v_member_id;
        if found then v_cleaned_count := v_cleaned_count + 1; end if;
      end loop;
    end if;

    select count(*)::integer into v_retained_count
    from public.trip_members
    where user_id = p_secondary_profile_id;
  end if;

  update public.device_link_tokens
  set used_at = pg_catalog.clock_timestamp()
  where id = v_token.id;

  return pg_catalog.jsonb_build_object(
    'profile_id', v_primary.id,
    'display_name', v_primary.display_name,
    'cleaned_count', v_cleaned_count,
    'retained_count', v_retained_count
  );
end;
$function$;

revoke execute on function public.redeem_device_link(uuid, text) from public;
revoke execute on function public.redeem_device_link(uuid, text) from anon;
revoke execute on function public.redeem_device_link(uuid, text) from authenticated;
grant execute on function public.redeem_device_link(uuid, text) to service_role;
