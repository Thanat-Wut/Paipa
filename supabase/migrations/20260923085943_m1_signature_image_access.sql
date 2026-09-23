-- Owners can read only signature objects currently attached to a member in
-- one of their trips. The existing own-prefix policy continues to serve the
-- signer; other members and nonmembers gain no Storage read access.
create policy "trip owners read member signatures"
on storage.objects for select to authenticated
using (
  bucket_id = 'signatures'
  and exists (
    select 1
    from public.trip_members as member
    join public.trips as trip on trip.id = member.trip_id
    where member.signature_path = storage.objects.name
      and trip.owner_id = (select auth.uid())
  )
);
