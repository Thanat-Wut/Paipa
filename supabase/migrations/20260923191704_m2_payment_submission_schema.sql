-- M2.2: payment submission ledger and relational idempotency constraints.
-- Submission APIs, proof Storage, review operations, and aggregates remain later phases.

create table public.payment_submissions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null,
  contributor_id uuid not null,
  client_request_id uuid not null,
  request_hash text not null,
  amount numeric(12,2) not null,
  payment_method text not null,
  payment_occurred_at timestamptz not null,
  proof_path text,
  status text not null default 'pending',
  note text not null default '',
  verified_by uuid,
  verified_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  rejection_reason text,
  resubmission_of uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payment_submissions_trip_id_fkey
    foreign key (trip_id) references public.trips(id) on delete restrict,
  constraint payment_submissions_contribution_fkey
    foreign key (trip_id, contributor_id)
    references public.contributions(trip_id, contributor_id) on delete restrict,
  constraint payment_submissions_verified_by_fkey
    foreign key (verified_by) references public.profiles(id) on delete restrict,
  constraint payment_submissions_rejected_by_fkey
    foreign key (rejected_by) references public.profiles(id) on delete restrict,

  constraint payment_submissions_request_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$'),
  -- numeric(12,2) bounds the value at 9,999,999,999.99 THB without adding
  -- a lower business cap that would discard legitimate overpayments.
  constraint payment_submissions_amount_check
    check (amount > 0 and amount <> 'NaN'::numeric),
  constraint payment_submissions_method_check
    check (payment_method in ('bank_transfer', 'cash', 'other')),
  constraint payment_submissions_proof_check
    check (
      (payment_method = 'bank_transfer'
        and proof_path is not null
        and btrim(proof_path) <> '')
      or
      (payment_method in ('cash', 'other')
        and (proof_path is null or btrim(proof_path) <> ''))
    ),
  constraint payment_submissions_status_check
    check (status in ('pending', 'verified', 'rejected')),
  constraint payment_submissions_review_state_check
    check (
      (
        status = 'pending'
        and verified_by is null and verified_at is null
        and rejected_by is null and rejected_at is null and rejection_reason is null
      )
      or
      (
        status = 'verified'
        and verified_by is not null and verified_at is not null
        and rejected_by is null and rejected_at is null and rejection_reason is null
      )
      or
      (
        status = 'rejected'
        and verified_by is null and verified_at is null
        and rejected_by is not null and rejected_at is not null
        and rejection_reason is not null and btrim(rejection_reason) <> ''
      )
    ),
  constraint payment_submissions_not_own_resubmission_check
    check (resubmission_of is null or resubmission_of <> id),
  constraint payment_submissions_scope_id_key
    unique (trip_id, contributor_id, id),
  constraint payment_submissions_request_key
    unique (trip_id, contributor_id, client_request_id),
  constraint payment_submissions_resubmission_parent_fkey
    foreign key (trip_id, contributor_id, resubmission_of)
    references public.payment_submissions(trip_id, contributor_id, id) on delete restrict
);

create index payment_submissions_pending_queue_idx
  on public.payment_submissions (trip_id, created_at desc)
  where status = 'pending';

create index payment_submissions_contributor_history_idx
  on public.payment_submissions (contributor_id, trip_id, created_at desc);

create index payment_submissions_verified_by_idx
  on public.payment_submissions (verified_by)
  where verified_by is not null;

create index payment_submissions_rejected_by_idx
  on public.payment_submissions (rejected_by)
  where rejected_by is not null;

create unique index payment_submissions_proof_path_uidx
  on public.payment_submissions (proof_path)
  where proof_path is not null;

create unique index payment_submissions_resubmission_parent_uidx
  on public.payment_submissions (resubmission_of)
  where resubmission_of is not null;

alter table public.payment_submissions enable row level security;
revoke all on table public.payment_submissions from public, anon, authenticated;
grant select, insert, update, delete on table public.payment_submissions to service_role;

create function private.prevent_payment_submission_resubmission_parent_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.resubmission_of is distinct from old.resubmission_of then
    raise exception 'Resubmission parent is immutable';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_payment_submission_resubmission_parent_change() from public, anon, authenticated;

create trigger payment_submissions_resubmission_parent_immutable
before update of resubmission_of on public.payment_submissions
for each row execute function private.prevent_payment_submission_resubmission_parent_change();
