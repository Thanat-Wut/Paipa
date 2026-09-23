-- Let a user clean up only the objects they uploaded under their own prefix.
-- This is needed to remove files uploaded just before a failed profile mutation.
create policy "user deletes own signature"
on storage.objects for delete to authenticated
using (
  bucket_id = 'signatures'
  and owner_id = (select auth.uid()::text)
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "user deletes own avatar"
on storage.objects for delete to authenticated
using (
  bucket_id = 'avatars'
  and owner_id = (select auth.uid()::text)
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
