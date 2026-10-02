create table public.report_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  schema_version text not null default 'report_snapshot/v1'
    check (schema_version = 'report_snapshot/v1'),
  analytics_version text not null default 'elyra-analytics/v1'
    check (analytics_version = 'elyra-analytics/v1'),
  cycle_heuristic_version text not null default 'elyra-cycle/v1'
    check (cycle_heuristic_version = 'elyra-cycle/v1'),
  time_zone text not null
    check (
      length(time_zone) between 1 and 64
      and time_zone ~ '^[A-Za-z0-9._+-]+(/[A-Za-z0-9._+-]+)*$'
    ),
  period_start date not null,
  period_end date not null,
  range_days smallint not null check (range_days in (28, 56, 90)),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  constraint report_snapshot_period_order check (period_end >= period_start),
  constraint report_snapshot_range_shape
    check ((period_end - period_start + 1) = range_days)
);

create index report_snapshots_user_created_idx
on public.report_snapshots (user_id, created_at desc);

alter table public.report_snapshots enable row level security;
alter table public.report_snapshots force row level security;

revoke all on table public.report_snapshots from anon, authenticated;
grant select, insert on table public.report_snapshots to authenticated;
grant all on table public.report_snapshots to service_role;

create policy report_snapshots_select_own
on public.report_snapshots for select to authenticated
using ((select auth.uid()) = user_id);

create policy report_snapshots_insert_own
on public.report_snapshots for insert to authenticated
with check ((select auth.uid()) = user_id);

-- Snapshot e append-only para o usuario: nao ha grant nem policy de UPDATE/DELETE.
-- Cascata de exclusao da conta e cleanup administrativo continuam possiveis.

create or replace function public.audit_stage08_snapshot_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    outcome,
    correlation_id
  ) values (
    auth.uid(),
    'report_snapshot_created',
    'report_snapshot',
    new.id,
    'success',
    gen_random_uuid()
  );
  return new;
end;
$$;

revoke all on function public.audit_stage08_snapshot_insert() from public;

create trigger report_snapshots_audit_insert
after insert on public.report_snapshots
for each row execute function public.audit_stage08_snapshot_insert();
