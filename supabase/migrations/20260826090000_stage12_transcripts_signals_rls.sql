-- Stage 12: transcricao, sinais observaveis derivados e interpretacao PedroCore.
-- Arquitetura on-device ratificada por ADR-0005. Learning continua fechado (Stage 13).
--
-- Tres invariantes materializadas aqui:
--   1. transcricao e sinal sao entidades SEPARADAS: apagar uma nao apaga a outra,
--      e nenhuma depende da midia bruta continuar existindo (ADR-0004, 7 dias);
--   2. sinal observavel NAO e emocao: o vocabulario e um check fechado;
--   3. `NULL` nao e zero: sinal nao capturado guarda `value = null` e status proprio.

-- ---------------------------------------------------------------------------
-- Novos tipos de job. `upload_finalize`/`media_cleanup` da 11A permanecem.
-- ---------------------------------------------------------------------------

alter table public.processing_jobs
drop constraint processing_jobs_job_kind_check;

alter table public.processing_jobs
add constraint processing_jobs_job_kind_check check (job_kind in (
  'upload_finalize', 'media_cleanup',
  'transcript_ingest', 'signal_extraction', 'session_interpretation'
));

-- ---------------------------------------------------------------------------
-- session_transcripts — uma transcricao por sessao, separada dos sinais.
-- ---------------------------------------------------------------------------

create table public.session_transcripts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique
    references public.multimodal_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  status text not null default 'pending' check (status in (
    'pending', 'available', 'unavailable', 'failed', 'deleted'
  )),
  language text not null default 'pt-BR' check (language = 'pt-BR'),
  -- Fonte da transcricao. `on_device_speech_api` e a unica fonte da V1 (ADR-0005);
  -- o check impede que um provider externo apareca sem migration e sem ADR.
  source text not null default 'on_device_speech_api'
    check (source in ('on_device_speech_api')),
  extractor_version text not null default 'elyra-signals/v1'
    check (extractor_version = 'elyra-signals/v1'),
  content text,
  word_count integer check (word_count is null or word_count between 0 and 20000),
  voiced_duration_ms integer
    check (voiced_duration_ms is null or voiced_duration_ms between 0 and 3600000),
  truncated boolean not null default false,
  unavailable_reason text check (
    unavailable_reason is null or char_length(unavailable_reason) between 1 and 80
  ),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  -- Conteudo so existe quando a transcricao esta disponivel. Nos demais estados
  -- o texto e obrigatoriamente ausente: nao ha transcricao "parcial" publicada.
  constraint session_transcript_content_shape check (
    (status = 'available'
      and content is not null
      and char_length(content) between 1 and 20000
      and word_count is not null
      and voiced_duration_ms is not null)
    or (status <> 'available'
      and content is null
      and word_count is null
      and voiced_duration_ms is null)
  ),
  constraint session_transcript_deleted_shape check (
    (status = 'deleted' and deleted_at is not null)
    or (status <> 'deleted' and deleted_at is null)
  )
);

create index session_transcripts_owner_idx
on public.session_transcripts (user_id, created_at desc)
where status <> 'deleted';

create trigger session_transcripts_set_updated_at
before update on public.session_transcripts
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- derived_features — sinais observaveis, comparados so a baseline pessoal.
-- ---------------------------------------------------------------------------

create table public.derived_features (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.multimodal_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  -- Vocabulario FECHADO. Emocao, sentimento, diagnostico e percentual afetivo
  -- nao tem nome nesta lista e nao podem ser inseridos.
  signal_name text not null check (signal_name in (
    'speech_rate',
    'pause_count',
    'pause_total_duration',
    'pause_mean_duration',
    'vocal_variation',
    'movement_frequency'
  )),
  unit text not null check (unit in (
    'words_per_minute', 'count', 'milliseconds', 'index'
  )),
  value double precision check (value is null or value >= 0),
  status text not null check (status in (
    'available', 'insufficient_baseline', 'not_captured'
  )),
  personal_baseline_mean double precision
    check (personal_baseline_mean is null or personal_baseline_mean >= 0),
  personal_baseline_samples smallint not null default 0
    check (personal_baseline_samples between 0 and 90),
  delta_vs_personal_baseline double precision,
  extractor_version text not null default 'elyra-signals/v1'
    check (extractor_version = 'elyra-signals/v1'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint derived_feature_unique_per_session unique (session_id, signal_name),
  -- Unidade coerente com o sinal: `speech_rate` em index seria dado sem sentido.
  constraint derived_feature_unit_matches_signal check (
    (signal_name = 'speech_rate' and unit = 'words_per_minute')
    or (signal_name = 'pause_count' and unit = 'count')
    or (signal_name in ('pause_total_duration', 'pause_mean_duration')
        and unit = 'milliseconds')
    or (signal_name in ('vocal_variation', 'movement_frequency') and unit = 'index')
  ),
  -- Indices sao normalizados em 0-1 por definicao (ADR-0005).
  constraint derived_feature_index_domain check (
    unit <> 'index' or value is null or (value >= 0 and value <= 1)
  ),
  -- NULL nao e zero: sinal nao capturado nao carrega valor.
  constraint derived_feature_not_captured_shape check (
    (status = 'not_captured' and value is null)
    or (status <> 'not_captured' and value is not null)
  ),
  -- Sem baseline real nao existe comparacao, e portanto nao existe delta.
  constraint derived_feature_baseline_shape check (
    (status = 'available'
      and personal_baseline_mean is not null
      and personal_baseline_samples >= 1)
    or (status <> 'available'
      and personal_baseline_mean is null
      and personal_baseline_samples = 0
      and delta_vs_personal_baseline is null)
  )
);

create index derived_features_owner_idx
on public.derived_features (user_id, created_at desc);
create index derived_features_session_idx
on public.derived_features (session_id, signal_name);

create trigger derived_features_set_updated_at
before update on public.derived_features
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- session_interpretations — saida PedroCore, imutavel e ligada a sessao.
-- ---------------------------------------------------------------------------

create table public.session_interpretations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.multimodal_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  contract_version text not null default 'elyra-multimodal/v1'
    check (contract_version = 'elyra-multimodal/v1'),
  signals_schema_version text not null default 'multimodal_signals/v1'
    check (signals_schema_version = 'multimodal_signals/v1'),
  correlation_id text not null check (char_length(correlation_id) between 3 and 128),
  -- Idempotencia duravel: mesma sessao + mesmo payload nao gera segunda
  -- interpretacao, e payload diferente nao reusa a anterior.
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  provider_used text not null check (provider_used in ('mock', 'gemini')),
  model text not null check (char_length(model) between 1 and 80),
  payload jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint session_interpretation_unique_fingerprint
    unique (session_id, request_fingerprint)
);

create index session_interpretations_owner_idx
on public.session_interpretations (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers de contrato: o que nao pode mudar depois de escrito.
-- ---------------------------------------------------------------------------

create or replace function public.protect_session_transcript_contract()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.user_id <> old.user_id or new.session_id <> old.session_id then
    raise exception 'ELYRA_TRANSCRIPT_OWNER_IMMUTABLE';
  end if;
  -- Transcricao apagada nao volta a existir por update.
  if old.status = 'deleted' and new.status <> 'deleted' then
    raise exception 'ELYRA_TRANSCRIPT_DELETION_IS_FINAL';
  end if;
  return new;
end;
$$;

create trigger session_transcripts_protect_contract
before update on public.session_transcripts
for each row execute function public.protect_session_transcript_contract();

create or replace function public.protect_derived_feature_contract()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.user_id <> old.user_id
    or new.session_id <> old.session_id
    or new.signal_name <> old.signal_name then
    raise exception 'ELYRA_DERIVED_FEATURE_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger derived_features_protect_contract
before update on public.derived_features
for each row execute function public.protect_derived_feature_contract();

-- Interpretacao e append-only: nunca editada, nunca apagada pelo dono.
create or replace function public.reject_session_interpretation_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'ELYRA_SESSION_INTERPRETATION_IS_IMMUTABLE';
end;
$$;

create trigger session_interpretations_reject_update
before update or delete on public.session_interpretations
for each row execute function public.reject_session_interpretation_mutation();

-- ---------------------------------------------------------------------------
-- Consentimento de inferencia ativo, derivado do log append-only da Stage 04.
--
-- `consent_events` nao guarda estado: guarda eventos. Ate a Stage 11 cada
-- consumidor reimplementava a leitura "grant vigente e nao revogado", e a
-- Stage 09 so a aplicava na camada de servico. Aqui ela vira uma funcao unica,
-- usada pela propria RLS, para que revogacao tenha efeito imediato no banco.
-- ---------------------------------------------------------------------------

create or replace function public.ai_inference_consent_active(p_user_id uuid)
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
      and granted.purpose = 'ai_inference'
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

revoke all on function public.ai_inference_consent_active(uuid) from public;
grant execute on function public.ai_inference_consent_active(uuid)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS fail-closed. Default deny; nada e legivel sem dono ou sem consentimento.
-- ---------------------------------------------------------------------------

alter table public.session_transcripts enable row level security;
alter table public.session_transcripts force row level security;
alter table public.derived_features enable row level security;
alter table public.derived_features force row level security;
alter table public.session_interpretations enable row level security;
alter table public.session_interpretations force row level security;

revoke all on table public.session_transcripts from anon, authenticated;
revoke all on table public.derived_features from anon, authenticated;
revoke all on table public.session_interpretations from anon, authenticated;
grant select, insert, update, delete on table public.session_transcripts to authenticated;
grant select, insert, update, delete on table public.derived_features to authenticated;
grant select, insert on table public.session_interpretations to authenticated;
grant all on table public.session_transcripts to service_role;
grant all on table public.derived_features to service_role;
grant all on table public.session_interpretations to service_role;

-- session_transcripts -------------------------------------------------------

create policy session_transcripts_select_own
on public.session_transcripts for select to authenticated
using ((select auth.uid()) = user_id);

-- Transcricao so nasce com consentimento de transcricao E de microfone, na
-- sessao do proprio dono. Consentimento de midia ou de IA nao substitui.
create policy session_transcripts_insert_own
on public.session_transcripts for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.multimodal_sessions session
    where session.id = session_transcripts.session_id
      and session.user_id = session_transcripts.user_id
      and session.transcription_consent
      and session.microphone_consent
  )
);
create policy session_transcripts_update_own
on public.session_transcripts for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy session_transcripts_delete_own
on public.session_transcripts for delete to authenticated
using ((select auth.uid()) = user_id);

-- Profissional le transcricao somente com o scope proprio de transcricao.
-- Compartilhar o resultado nunca compartilha a transcricao.
create policy session_transcripts_select_professional
on public.session_transcripts for select to authenticated
using (
  status = 'available'
  and exists (
    select 1 from public.multimodal_sessions session
    where session.id = session_transcripts.session_id
      and session.user_id = session_transcripts.user_id
      and session.share_transcript_consent
      and public.professional_access_allowed(
        session_transcripts.user_id, 'multimodal_transcript'
      )
  )
);

-- derived_features ----------------------------------------------------------

create policy derived_features_select_own
on public.derived_features for select to authenticated
using ((select auth.uid()) = user_id);

-- Sinal so nasce com consentimento de analise multimodal, e apenas quando a
-- captura correspondente existiu: sinal de audio exige microfone, sinal de
-- movimento exige camera. Sem isso o numero seria fabricado.
create policy derived_features_insert_own
on public.derived_features for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.multimodal_sessions session
    where session.id = derived_features.session_id
      and session.user_id = derived_features.user_id
      and session.ai_analysis_consent
      and (
        derived_features.status = 'not_captured'
        or case
          when derived_features.signal_name = 'movement_frequency'
            then session.camera_consent
          else session.microphone_consent
        end
      )
  )
);
create policy derived_features_update_own
on public.derived_features for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy derived_features_delete_own
on public.derived_features for delete to authenticated
using ((select auth.uid()) = user_id);

create policy derived_features_select_professional
on public.derived_features for select to authenticated
using (
  exists (
    select 1 from public.multimodal_sessions session
    where session.id = derived_features.session_id
      and session.user_id = derived_features.user_id
      and session.share_result_consent
      and public.professional_access_allowed(
        derived_features.user_id, 'multimodal_result'
      )
  )
);

-- session_interpretations ---------------------------------------------------

create policy session_interpretations_select_own
on public.session_interpretations for select to authenticated
using ((select auth.uid()) = user_id);

-- Interpretacao exige consentimento de IA E de analise multimodal, os dois.
create policy session_interpretations_insert_own
on public.session_interpretations for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.multimodal_sessions session
    where session.id = session_interpretations.session_id
      and session.user_id = session_interpretations.user_id
      and session.ai_analysis_consent
  )
  and public.ai_inference_consent_active(session_interpretations.user_id)
);

create policy session_interpretations_select_professional
on public.session_interpretations for select to authenticated
using (
  exists (
    select 1 from public.multimodal_sessions session
    where session.id = session_interpretations.session_id
      and session.user_id = session_interpretations.user_id
      and session.share_result_consent
      and public.professional_access_allowed(
        session_interpretations.user_id, 'multimodal_result'
      )
  )
);

-- ---------------------------------------------------------------------------
-- Audit das escritas Stage 12.
-- ---------------------------------------------------------------------------

create or replace function public.audit_stage12_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  row_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
  entity_name text := case tg_table_name
    when 'session_transcripts' then 'session_transcript'
    when 'derived_features' then 'derived_feature'
    when 'session_interpretations' then 'session_interpretation'
  end;
begin
  -- O audit registra o EVENTO, nunca o conteudo: sem transcricao, sem texto,
  -- sem payload de interpretacao e sem valor de sinal.
  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, entity_name || '.' || lower(tg_op), entity_name, row_id,
    'success', gen_random_uuid()
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger session_transcripts_audit_write
after insert or update or delete on public.session_transcripts
for each row execute function public.audit_stage12_write();
create trigger derived_features_audit_write
after insert or update or delete on public.derived_features
for each row execute function public.audit_stage12_write();
create trigger session_interpretations_audit_write
after insert on public.session_interpretations
for each row execute function public.audit_stage12_write();

revoke all on function public.protect_session_transcript_contract() from public;
revoke all on function public.protect_derived_feature_contract() from public;
revoke all on function public.reject_session_interpretation_mutation() from public;
revoke all on function public.audit_stage12_write() from public;
