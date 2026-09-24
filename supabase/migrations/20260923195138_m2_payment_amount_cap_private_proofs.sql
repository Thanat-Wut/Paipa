-- M2.3 corrective amount cap and private proof bucket.
-- Never alter the already-applied M2.2 migration.

alter table public.payment_submissions
  drop constraint if exists payment_submissions_amount_check;

alter table public.payment_submissions
  add constraint payment_submissions_amount_check
  check (
    amount > 0
    and amount <= 100000000
    and amount <> 'NaN'::numeric
  );

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
