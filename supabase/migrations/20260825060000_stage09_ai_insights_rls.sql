-- Stage 09: interpretacao textual Elyra -> PedroCore.
-- A migration e aditiva. Insights sao outcomes imutaveis e nunca alteram analytics.

create or replace function public.set_ai_inference_consent(enabled boolean)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  active_grant_id uuid;
  event_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('elyra:ai_inference:' || current_user_id::text, 0)
  );

  select granted.id into active_grant_id
  from public.consent_events granted
  where granted.user_id = current_user_id
    and granted.purpose = 'ai_inference'
    and granted.document_version = 'v1'
    and granted.event_type = 'granted'
    and (granted.expires_at is null or granted.expires_at > timezone('utc', now()))
    and not exists (
      select 1
      from public.consent_events revoked
      where revoked.granted_event_id = granted.id
        and revoked.event_type = 'revoked'
    )
  order by granted.occurred_at desc
  limit 1;

  if enabled then
    if active_grant_id is not null then
      return active_grant_id;
    end if;
    insert into public.consent_events (
      user_id, purpose, document_version, event_type
    ) values (
      current_user_id, 'ai_inference', 'v1', 'granted'
    ) returning id into event_id;
    return event_id;
  end if;

  if active_grant_id is null then
    return null;
  end if;
  insert into public.consent_events (
    user_id, purpose, document_version, event_type, granted_event_id
  ) values (
    current_user_id, 'ai_inference', 'v1', 'revoked', active_grant_id
  ) returning id into event_id;
  return event_id;
end;
$$;

revoke all on function public.set_ai_inference_consent(boolean) from public, anon;
grant execute on function public.set_ai_inference_consent(boolean) to authenticated, service_role;

alter table public.report_snapshots
  add constraint report_snapshots_id_user_unique unique (id, user_id);

create table public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_snapshot_id uuid not null,
  contract_version text not null default 'elyra-textual/v1'
    check (contract_version = 'elyra-textual/v1'),
  output_schema_version text not null default 'elyra-textual-output/v1'
    check (output_schema_version = 'elyra-textual-output/v1'),
  operation text not null default 'interpret_deterministic_report'
    check (operation = 'interpret_deterministic_report'),
  correlation_id uuid not null,
  idempotency_key_fingerprint text not null
    check (idempotency_key_fingerprint ~ '^[0-9a-f]{64}$'),
  request_fingerprint text not null
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  provider_used text not null check (provider_used in ('mock', 'gemini')),
  model text not null,
  fallback_used boolean not null default false check (fallback_used = false),
  output jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint ai_insights_snapshot_owner_fkey
    foreign key (report_snapshot_id, user_id)
    references public.report_snapshots(id, user_id)
    on delete cascade,
  constraint ai_insights_provider_model_check check (
    (provider_used = 'mock' and model = 'mock-v1')
    or (provider_used = 'gemini' and model = 'gemini-3.5-flash')
  ),
  constraint ai_insights_output_contract_check check (
    jsonb_typeof(output) = 'object'
    and output ->> 'contractVersion' = 'elyra-textual/v1'
    and output ->> 'outputSchemaVersion' = 'elyra-textual-output/v1'
    and output ->> 'operation' = 'interpret_deterministic_report'
    and output ->> 'sourceReportSchemaVersion' = 'report_snapshot/v1'
    and output ->> 'sourceAnalyticsVersion' = 'elyra-analytics/v1'
    and output ->> 'correlationId' = correlation_id::text
  ),
  constraint ai_insights_user_idempotency_unique
    unique (user_id, idempotency_key_fingerprint),
  constraint ai_insights_user_correlation_unique
    unique (user_id, correlation_id)
);

create index ai_insights_snapshot_created_idx
on public.ai_insights (report_snapshot_id, created_at desc);

alter table public.ai_insights enable row level security;
alter table public.ai_insights force row level security;

revoke all on table public.ai_insights from anon, authenticated;
grant select, insert on table public.ai_insights to authenticated;
grant all on table public.ai_insights to service_role;

create policy ai_insights_select_own
on public.ai_insights for select to authenticated
using ((select auth.uid()) = user_id);

create policy ai_insights_insert_own
on public.ai_insights for insert to authenticated
with check ((select auth.uid()) = user_id);

-- Insight e append-only para o usuario: nenhuma policy/grant de UPDATE ou DELETE.

create or replace function public.audit_stage09_ai_insight_insert()
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
    'ai_insight_created',
    'ai_insight',
    new.id,
    'success',
    new.correlation_id
  );
  return new;
end;
$$;

revoke all on function public.audit_stage09_ai_insight_insert() from public;

create trigger ai_insights_audit_insert
after insert on public.ai_insights
for each row execute function public.audit_stage09_ai_insight_insert();
