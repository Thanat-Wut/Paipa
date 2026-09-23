-- Keep trips created through the RPC and owner edits through the table API
-- inside the same contract as the server-side form schema.
alter table public.trips drop constraint trips_name_check;
alter table public.trips add constraint trips_name_check
  check (name = btrim(name) and char_length(name) between 2 and 80);

alter table public.trips add constraint trips_description_length_check
  check (description = btrim(description) and char_length(description) <= 500);
alter table public.trips add constraint trips_destination_length_check
  check (destination = btrim(destination) and char_length(destination) <= 120);

alter table public.trips drop constraint trips_budget_per_person_check;
alter table public.trips add constraint trips_budget_per_person_check
  check (budget_per_person between 0 and 1000000);

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

  insert into public.trip_members(trip_id, user_id, display_name, role)
  select v_trip_id, id, display_name, 'owner'
  from public.profiles where id = (select auth.uid());

  return v_trip_id;
end;
$$;

-- This SECURITY DEFINER function is an internal DDL event-trigger handler.
-- It does not need to be exposed as a PostgREST RPC to app roles.
revoke all on function public.rls_auto_enable() from public, anon, authenticated, service_role;
