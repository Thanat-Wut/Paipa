create index expenses_created_by_idx on public.expenses (created_by);
create index expenses_paid_by_idx on public.expenses (paid_by);
create index expenses_deleted_by_idx on public.expenses (deleted_by);