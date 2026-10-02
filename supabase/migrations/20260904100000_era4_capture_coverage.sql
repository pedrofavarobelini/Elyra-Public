-- Era 4 / 22A - cobertura de captura, e o fim de "parcial passa por completa".
--
-- **O defeito.** Uma camera que morria aos 10 segundos de uma sessao de 30
-- minutos produzia `movement_frequency` com `status = 'available'`, comparado
-- contra a baseline pessoal, sem que nada na cadeia registrasse que a base de
-- calculo foi 0,5% da sessao. O numero era honesto por construcao e enganoso por
-- contexto - o pior tipo, porque nao ha como desconfiar dele.
--
-- **A correcao.** Cobertura por modalidade vira dado de primeira classe, com
-- desfecho vindo do **evento** que aconteceu (track encerrada, gravacao no teto,
-- permissao negada) e nao de um limiar escolhido por gosto. `coverage_ms` viaja
-- ao lado como medida, nunca como classificador.
--
-- **Aditiva.** Nenhum drop de tabela, nenhuma coluna removida, nenhum dado
-- apagado. Os `check` de versao sao **alargados** para aceitar v2 ao lado de v1,
-- entao toda linha ja gravada continua valida.

-- ---------------------------------------------------------------------------
-- 1. Teto de midia coerente com a duracao da sessao
--
-- 5 MB nunca pode ter valido junto com `duration_ms <= 3600000`: qualquer sessao
-- longa com gravacao ligada era recusada no upload. 32 MiB cabe com folga no
-- limite de 50 MiB do bucket. Quanto tempo isso representa nao e decidido aqui -
-- sai do bitrate declarado em `MEDIA_RECORDING_MAX_MS`, no cliente, para que os
-- dois numeros nao possam divergir.
-- ---------------------------------------------------------------------------

alter table public.media_assets
  drop constraint if exists media_assets_size_bytes_check;
alter table public.media_assets
  add constraint media_assets_size_bytes_check
  check (size_bytes between 1 and 33554432);

-- ---------------------------------------------------------------------------
-- 2. Cobertura por modalidade
--
-- Uma linha por (sessao, modalidade). Modalidade nao autorizada tambem entra,
-- com `not_requested`: o dossie profissional precisa distinguir "nao foi pedida"
-- de "foi pedida e falhou", e ausencia de linha nao distingue nada.
-- ---------------------------------------------------------------------------

create table if not exists public.session_modality_coverage (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.multimodal_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  modality text not null check (modality in ('screen', 'camera', 'microphone')),
  outcome text not null check (outcome in ('full', 'partial', 'absent')),
  -- Vocabulario FECHADO de motivos. Texto livre aqui viraria, mais cedo ou mais
  -- tarde, uma explicacao inventada na tela do profissional.
  reason text check (reason in (
    'not_requested', 'unsupported', 'denied', 'cancelled', 'error',
    'interrupted', 'recording_capped'
  )),
  coverage_ms integer not null default 0
    check (coverage_ms between 0 and 3600000),
  session_duration_ms integer not null
    check (session_duration_ms between 0 and 3600000),
  extractor_version text not null default 'elyra-signals/v2'
    check (extractor_version in ('elyra-signals/v1', 'elyra-signals/v2')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  constraint session_modality_coverage_unique unique (session_id, modality),

  -- Cobertura nao pode exceder a sessao que ela cobre.
  constraint session_modality_coverage_within_session check (
    coverage_ms <= session_duration_ms
  ),

  -- Cobertura completa nao tem motivo; incompleta sempre tem.
  constraint session_modality_coverage_reason_shape check (
    (outcome = 'full' and reason is null)
    or (outcome <> 'full' and reason is not null)
  ),

  -- Motivo coerente com o desfecho: perder a track e limite de gravacao sao
  -- parciais; permissao e suporte sao ausencia. Cruzar os dois esconderia qual
  -- dos dois aconteceu.
  constraint session_modality_coverage_reason_domain check (
    outcome = 'full'
    or (outcome = 'partial' and reason in ('interrupted', 'recording_capped'))
    or (outcome = 'absent' and reason in (
      'not_requested', 'unsupported', 'denied', 'cancelled', 'error'
    ))
  ),

  -- Ausencia nao carrega tempo. `coverage_ms > 0` aqui afirmaria captura, que e
  -- exatamente o que `absent` nega.
  constraint session_modality_coverage_absent_shape check (
    outcome <> 'absent' or coverage_ms = 0
  )
);

comment on table public.session_modality_coverage is
  'Quanto tempo cada modalidade esteve ativa numa sessao, e por que nao mais.';

create index if not exists session_modality_coverage_owner_idx
  on public.session_modality_coverage (user_id, created_at desc);
create index if not exists session_modality_coverage_session_idx
  on public.session_modality_coverage (session_id, modality);

create trigger session_modality_coverage_set_updated_at
before update on public.session_modality_coverage
for each row execute function public.set_updated_at();

alter table public.session_modality_coverage enable row level security;
alter table public.session_modality_coverage force row level security;

create policy session_modality_coverage_select_own
on public.session_modality_coverage for select to authenticated
using ((select auth.uid()) = user_id);

create policy session_modality_coverage_insert_own
on public.session_modality_coverage for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.multimodal_sessions session
    where session.id = session_modality_coverage.session_id
      and session.user_id = session_modality_coverage.user_id
  )
);

create policy session_modality_coverage_update_own
on public.session_modality_coverage for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Leitura profissional acompanha o **resultado**: cobertura descreve como o
-- resultado foi produzido, e um dossie que mostra o numero sem mostrar a
-- cobertura recria exatamente o defeito que esta migration fecha.
create policy session_modality_coverage_select_professional
on public.session_modality_coverage for select to authenticated
using (
  exists (
    select 1 from public.multimodal_sessions session
    where session.id = session_modality_coverage.session_id
      and session.user_id = session_modality_coverage.user_id
      and session.share_result_consent
      and public.professional_access_allowed(
        session_modality_coverage.user_id, 'multimodal_result'
      )
  )
);

-- Grants de tabela. A RLS decide **quais** linhas; o grant decide se a role
-- alcanca a tabela. Sem os dois, a policy correta devolve "permission denied".
-- Sem `delete` para `authenticated`: cobertura e registro do que aconteceu, e
-- apagar seletivamente permitiria maquiar uma sessao parcial. A exclusao real
-- acontece por cascade quando a sessao inteira e apagada.
grant select, insert, update on table public.session_modality_coverage to authenticated;
grant all on table public.session_modality_coverage to service_role;

-- ---------------------------------------------------------------------------
-- 3. O sinal derivado passa a carregar a cobertura que o produziu
--
-- Sem isto, cobertura viveria numa tabela ao lado e o sinal continuaria viajando
-- sozinho para a tela, para a baseline e para o Veltrix - que e onde o engano
-- acontecia.
-- ---------------------------------------------------------------------------

alter table public.derived_features
  add column if not exists coverage_ms integer
    check (coverage_ms is null or coverage_ms between 0 and 3600000),
  add column if not exists coverage_outcome text
    check (coverage_outcome is null
           or coverage_outcome in ('full', 'partial', 'absent'));

comment on column public.derived_features.coverage_ms is
  'Tempo de captura da modalidade que produziu este sinal. NULL = linha anterior a Era 4.';
comment on column public.derived_features.coverage_outcome is
  'Desfecho da captura da modalidade que produziu este sinal.';

-- **O que estas duas colunas nao afirmam.**
--
-- A primeira versao desta migration exigia que `status = 'not_captured'`
-- implicasse cobertura ausente. Estava errado, e o E2E de navegador sem
-- reconhecimento de fala provou: um microfone capturado a sessao inteira produz
-- `speech_rate = not_captured` quando nao houve transcricao, porque falta o
-- **numerador**, e nao a captura. Status do sinal e cobertura da modalidade sao
-- fatos ortogonais, e amarra-los apagaria justamente a distincao que esta Era
-- existe para criar.
--
-- O que continua valendo e a coerencia interna do par: ou as duas colunas
-- descrevem uma cobertura, ou nenhuma das duas descreve.
alter table public.derived_features
  drop constraint if exists derived_feature_coverage_shape;
alter table public.derived_features
  add constraint derived_feature_coverage_shape check (
    (coverage_ms is null and coverage_outcome is null)
    or (coverage_ms is not null and coverage_outcome is not null)
  );

-- ---------------------------------------------------------------------------
-- 4. Versoes de contrato: alargar, nunca trocar
--
-- Linhas gravadas com v1 continuam validas. Um `check` de igualdade trocado por
-- outro de igualdade invalidaria retroativamente o historico - que e destrutivo
-- sem apagar nada.
-- ---------------------------------------------------------------------------

alter table public.derived_features
  drop constraint if exists derived_features_extractor_version_check;
alter table public.derived_features
  add constraint derived_features_extractor_version_check
  check (extractor_version in ('elyra-signals/v1', 'elyra-signals/v2'));
alter table public.derived_features
  alter column extractor_version set default 'elyra-signals/v2';

alter table public.session_transcripts
  drop constraint if exists session_transcripts_extractor_version_check;
alter table public.session_transcripts
  add constraint session_transcripts_extractor_version_check
  check (extractor_version in ('elyra-signals/v1', 'elyra-signals/v2'));
alter table public.session_transcripts
  alter column extractor_version set default 'elyra-signals/v2';

alter table public.session_interpretations
  drop constraint if exists session_interpretations_contract_version_check;
alter table public.session_interpretations
  add constraint session_interpretations_contract_version_check
  check (contract_version in ('elyra-multimodal/v1', 'elyra-multimodal/v2'));
alter table public.session_interpretations
  alter column contract_version set default 'elyra-multimodal/v2';

alter table public.session_interpretations
  drop constraint if exists session_interpretations_signals_schema_version_check;
alter table public.session_interpretations
  add constraint session_interpretations_signals_schema_version_check
  check (signals_schema_version in ('multimodal_signals/v1', 'multimodal_signals/v2'));
alter table public.session_interpretations
  alter column signals_schema_version set default 'multimodal_signals/v2';

-- ---------------------------------------------------------------------------
-- 5. Auditoria da escrita de cobertura
-- ---------------------------------------------------------------------------

create or replace function public.audit_era4_coverage_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  row_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
begin
  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    auth.uid(),
    'session_modality_coverage.' || lower(tg_op),
    'session_modality_coverage',
    row_id,
    'success',
    gen_random_uuid()
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger session_modality_coverage_audit
after insert or update or delete on public.session_modality_coverage
for each row execute function public.audit_era4_coverage_write();
