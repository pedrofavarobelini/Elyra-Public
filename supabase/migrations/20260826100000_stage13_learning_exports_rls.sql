-- Stage 13: learning governado. Elyra -> PedroCore Dataset Foundation.
--
-- Esta migration NAO habilita treinamento. Ela materializa a governanca que
-- precede qualquer uso futuro de um dado para evolucao: consentimento proprio,
-- elegibilidade, proveniencia, fingerprint canonico e registro de exportacao.
--
-- Tres invariantes:
--   1. consentimento de TREINO e independente de storage, inferencia,
--      compartilhamento profissional, multimodal e ciclo;
--   2. `learning_exports` guarda GOVERNANCA, nao conteudo: o payload sanitizado
--      e transitorio e nunca e copiado para ca;
--   3. profissional nunca alcanca `learning_exports`, por scope nenhum.

-- ---------------------------------------------------------------------------
-- Consentimento de treino — proprio, versionado e revogavel.
-- ---------------------------------------------------------------------------

-- Espelha `set_ai_inference_consent` da Stage 09. Sao proposito e documento
-- SEPARADOS: consentir inferencia nunca consente treino.
create or replace function public.set_training_consent(enabled boolean)
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
    pg_catalog.hashtextextended('elyra:training_data:' || current_user_id::text, 0)
  );

  select granted.id into active_grant_id
  from public.consent_events granted
  where granted.user_id = current_user_id
    and granted.purpose = 'training_data'
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
      current_user_id, 'training_data', 'v1', 'granted'
    ) returning id into event_id;
    return event_id;
  end if;

  if active_grant_id is null then
    return null;
  end if;
  insert into public.consent_events (
    user_id, purpose, document_version, event_type, granted_event_id
  ) values (
    current_user_id, 'training_data', 'v1', 'revoked', active_grant_id
  ) returning id into event_id;
  return event_id;
end;
$$;

revoke all on function public.set_training_consent(boolean) from public, anon;
grant execute on function public.set_training_consent(boolean)
to authenticated, service_role;

-- Estado vigente derivado do log append-only, como em `ai_inference_consent_active`.
-- Reavaliado a cada consulta: revogar tem efeito imediato.
create or replace function public.training_consent_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
    from public.consent_events granted
    where granted.user_id = p_user_id
      and granted.purpose = 'training_data'
      and granted.document_version = 'v1'
      and granted.event_type = 'granted'
      and (granted.expires_at is null
           or granted.expires_at > timezone('utc', now()))
      and not exists (
        select 1
        from public.consent_events revoked
        where revoked.granted_event_id = granted.id
          and revoked.event_type = 'revoked'
      )
  ), false);
$$;

revoke all on function public.training_consent_active(uuid) from public;
grant execute on function public.training_consent_active(uuid)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Elegibilidade de treino na sessao multimodal.
--
-- A Stage 11 travou `training_eligibility_consent` em `false` com um CHECK,
-- porque nao havia politica. A Stage 13 e a Stage autorizada a abrir o
-- contrato — mas remover o CHECK sem substituto deixaria a coluna livre.
-- O CHECK sai e entra uma politica explicita: a flag so pode ser ligada
-- enquanto existir consentimento de treino vigente do proprio dono.
-- ---------------------------------------------------------------------------

alter table public.multimodal_sessions
drop constraint multimodal_stage11_learning_closed;

create or replace function public.enforce_training_eligibility_policy()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.training_eligibility_consent then
    if not public.training_consent_active(new.user_id) then
      raise exception 'ELYRA_TRAINING_CONSENT_REQUIRED';
    end if;
  end if;
  return new;
end;
$$;

create trigger multimodal_sessions_training_eligibility
before insert or update of training_eligibility_consent
on public.multimodal_sessions
for each row execute function public.enforce_training_eligibility_policy();

revoke all on function public.enforce_training_eligibility_policy() from public;

-- ---------------------------------------------------------------------------
-- learning_exports — registro de governanca da exportacao.
--
-- Guarda o QUE foi decidido e POR QUE, nunca o conteudo. O payload sanitizado
-- e transitorio: ele existe para ser enviado, e o que fica e o fingerprint que
-- o identifica. Copiar o payload para ca criaria uma segunda base de dados de
-- treino dentro da Elyra — exatamente o que a governanca evita.
-- ---------------------------------------------------------------------------

create table public.learning_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_snapshot_id uuid not null,

  contract_version text not null default 'elyra-learning/v1'
    check (contract_version = 'elyra-learning/v1'),
  export_schema_version text not null default 'elyra-learning-export/v1'
    check (export_schema_version = 'elyra-learning-export/v1'),
  policy_version text not null default 'elyra-learning-policy/v1'
    check (policy_version = 'elyra-learning-policy/v1'),
  source_schema_version text not null default 'report_snapshot/v1'
    check (source_schema_version = 'report_snapshot/v1'),
  analytics_version text not null default 'elyra-analytics/v1'
    check (analytics_version = 'elyra-analytics/v1'),

  -- Fingerprint do payload canonico sanitizado. E a identidade do export.
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),

  status text not null check (status in (
    'eligible', 'exported', 'rejected', 'revoked'
  )),
  -- Inelegivel e resultado normal, nao erro tecnico: tem codigo proprio.
  rejection_code text check (
    rejection_code is null or rejection_code in (
      'training_consent_missing',
      'training_consent_revoked',
      'insufficient_data',
      'quality_gate_failed',
      'sanitization_failed',
      'provenance_invalid',
      'source_not_allowed',
      'pedrocore_denied'
    )
  ),
  quality_passed boolean not null,

  -- Referencia ao Candidate do PedroCore. A Elyra guarda a referencia; o
  -- PedroCore continua dono do TrainingExampleCandidate.
  candidate_id text check (
    candidate_id is null or candidate_id ~ '^training-candidate-[0-9a-f]{24}$'
  ),
  candidate_lifecycle text check (
    candidate_lifecycle is null or candidate_lifecycle in (
      'proposed', 'authorized', 'review_required', 'excluded', 'revoked', 'consumed'
    )
  ),

  correlation_id text not null check (char_length(correlation_id) between 3 and 128),
  -- Proveniencia do consentimento que autorizou este export.
  training_consent_event_id uuid references public.consent_events(id)
    on delete restrict,

  produced_at timestamptz not null,
  exported_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text check (
    revocation_reason is null or revocation_reason in (
      'training_consent_revoked', 'user_data_deleted', 'eligibility_lost'
    )
  ),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  -- Snapshot precisa pertencer ao mesmo dono: FK composta, nao apenas por id.
  constraint learning_export_snapshot_belongs_to_owner
    foreign key (report_snapshot_id, user_id)
    references public.report_snapshots(id, user_id) on delete cascade,

  -- Idempotencia duravel: o mesmo conteudo governado nao exporta duas vezes.
  constraint learning_export_unique_fingerprint unique (user_id, fingerprint),

  -- Um snapshot produz no maximo um export por versao de politica.
  constraint learning_export_unique_snapshot
    unique (user_id, report_snapshot_id, policy_version),

  constraint learning_export_exported_shape check (
    (status = 'exported'
      and candidate_id is not null
      and candidate_lifecycle is not null
      and exported_at is not null
      and quality_passed)
    -- `revoked` preserva `exported_at` como historico: e a prova de que o
    -- candidato chegou a atravessar a fronteira antes de ser revogado.
    or (status = 'revoked')
    -- `eligible` e `rejected` nunca alcancaram o PedroCore.
    or (status in ('eligible', 'rejected') and exported_at is null)
  ),
  constraint learning_export_rejected_shape check (
    (status = 'rejected' and rejection_code is not null and candidate_id is null)
    or (status <> 'rejected' and rejection_code is null)
  ),
  constraint learning_export_revoked_shape check (
    (status = 'revoked' and revoked_at is not null and revocation_reason is not null)
    or (status <> 'revoked' and revoked_at is null and revocation_reason is null)
  ),
  -- Elegivel ainda nao alcancou o PedroCore.
  constraint learning_export_eligible_shape check (
    status <> 'eligible' or candidate_id is null
  )
);

create index learning_exports_owner_created_idx
on public.learning_exports (user_id, created_at desc);
create index learning_exports_status_idx
on public.learning_exports (user_id, status);

create trigger learning_exports_set_updated_at
before update on public.learning_exports
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Contrato imutavel do export.
-- ---------------------------------------------------------------------------

create or replace function public.protect_learning_export_contract()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.user_id <> old.user_id
    or new.report_snapshot_id <> old.report_snapshot_id
    or new.fingerprint <> old.fingerprint
    or new.policy_version <> old.policy_version then
    raise exception 'ELYRA_LEARNING_EXPORT_IDENTITY_IMMUTABLE';
  end if;

  -- Revogacao e final: um export revogado nao volta a ser exportavel.
  if old.status = 'revoked' and new.status <> 'revoked' then
    raise exception 'ELYRA_LEARNING_REVOCATION_IS_FINAL';
  end if;

  -- Candidate id, uma vez atribuido, nao muda: e a referencia de governanca.
  if old.candidate_id is not null and new.candidate_id is distinct from old.candidate_id then
    raise exception 'ELYRA_LEARNING_CANDIDATE_REFERENCE_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger learning_exports_protect_contract
before update on public.learning_exports
for each row execute function public.protect_learning_export_contract();

-- Export exige consentimento de treino vigente no momento da escrita.
create or replace function public.enforce_learning_export_consent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.training_consent_active(new.user_id) then
    raise exception 'ELYRA_TRAINING_CONSENT_REQUIRED';
  end if;
  return new;
end;
$$;

create trigger learning_exports_require_consent
before insert on public.learning_exports
for each row execute function public.enforce_learning_export_consent();

revoke all on function public.protect_learning_export_contract() from public;
revoke all on function public.enforce_learning_export_consent() from public;

-- ---------------------------------------------------------------------------
-- RLS fail-closed. Owner-only e SEM fronteira profissional.
-- ---------------------------------------------------------------------------

alter table public.learning_exports enable row level security;
alter table public.learning_exports force row level security;

revoke all on table public.learning_exports from anon, authenticated;
-- Sem DELETE: o historico de governanca nao desaparece; revogacao e um estado.
grant select, insert, update on table public.learning_exports to authenticated;
grant all on table public.learning_exports to service_role;

create policy learning_exports_select_own
on public.learning_exports for select to authenticated
using ((select auth.uid()) = user_id);

create policy learning_exports_insert_own
on public.learning_exports for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and public.training_consent_active(user_id)
  and exists (
    select 1 from public.report_snapshots snapshot
    where snapshot.id = learning_exports.report_snapshot_id
      and snapshot.user_id = learning_exports.user_id
  )
);

create policy learning_exports_update_own
on public.learning_exports for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- NAO existe policy profissional para `learning_exports`, e isso e deliberado.
-- Nenhum dos nove scopes de compartilhamento alcanca learning: governanca de
-- treino nao e resultado clinico, nem dado compartilhavel com terceiros.

-- ---------------------------------------------------------------------------
-- Audit — evento, nunca conteudo.
-- ---------------------------------------------------------------------------

create or replace function public.audit_stage13_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
begin
  -- Registra o QUE aconteceu e o estado resultante. Nunca o payload, nunca o
  -- relatorio, nunca o texto que originou o fingerprint.
  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id,
    'learning_export.' || lower(tg_op) || '.' || new.status,
    'learning_export',
    new.id,
    case when new.status = 'rejected' then 'denied' else 'success' end,
    gen_random_uuid()
  );
  return new;
end;
$$;

create trigger learning_exports_audit_write
after insert or update on public.learning_exports
for each row execute function public.audit_stage13_write();

revoke all on function public.audit_stage13_write() from public;
