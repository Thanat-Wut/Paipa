-- M2.2: cover all columns in the composite self-referencing FK.
create index payment_submissions_resubmission_scope_idx
  on public.payment_submissions (trip_id, contributor_id, resubmission_of)
  where resubmission_of is not null;
