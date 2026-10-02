-- ---------------------------------------------------------------------------
-- Stage 22-V - Visual Behavioral Observation
--
-- Aditiva. Nenhuma coluna e removida, nenhum dado e reescrito, nenhum `check` e
-- estreitado: todos os que mudam sao **alargados** para aceitar o vocabulario
-- visual ao lado do que ja existia. Linha gravada antes desta migration
-- continua valida depois dela.
--
-- O que passa a existir: consentimento proprio de analise visual, cobertura das
-- modalidades visuais, e cinco sinais derivados de geometria corporal.
--
-- O que **nao** passa a existir, e nao pode passar por engano: quadro, imagem,
-- coordenada de landmark, template facial, emocao, diagnostico. Nenhuma tabela
-- desta migration tem coluna capaz de guardar qualquer um deles.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Consentimento proprio
--
-- `camera_consent` responde "posso registrar sua imagem?". Esta coluna responde
-- "posso extrair geometria do seu corpo dessa imagem?". Sao perguntas
-- diferentes, e derivar a segunda da primeira seria consentimento presumido -
-- o mesmo erro que `transcription_consent` ja evita em relacao a
-- `microphone_consent`.
--
-- `default false`: como toda permissao desta plataforma, nasce desligada.
-- ---------------------------------------------------------------------------

alter table public.multimodal_sessions
  add column if not exists visual_analysis_consent boolean not null default false;

comment on column public.multimodal_sessions.visual_analysis_consent is
  'Analise de sinais visuais on-device autorizada para esta sessao. Nao decorre de camera_consent.';

-- Analise visual sem camera e impossivel, e uma linha assim so poderia existir
-- por defeito. O banco recusa em vez de confiar na aplicacao.
alter table public.multimodal_sessions
  drop constraint if exists multimodal_sessions_visual_requires_camera;
alter table public.multimodal_sessions
  add constraint multimodal_sessions_visual_requires_camera
  check (not visual_analysis_consent or camera_consent);

-- ---------------------------------------------------------------------------
-- 2. Cobertura das modalidades visuais
--
-- `camera` diz que a camera esteve ligada. `visual_face` diz que houve rosto
-- observavel. As duas divergem a sessao inteira quando alguem fica fora do
-- enquadramento, e sem a segunda um sinal de cabeca derivado de 6 minutos
-- viajaria como se falasse de 30 - a mesma leitura enganosa que a Era 4 fechou
-- para as modalidades de captura.
--
-- Dois motivos novos, ambos exclusivos do visual e ambos irredutiveis aos que
-- ja existiam:
--   `not_observed`  - a analise rodou e a modalidade nunca apareceu. Nao e
--                     falha, nao e falta de permissao: e medida cujo resultado
--                     foi ausencia.
--   `out_of_frame`  - a analise rodou o tempo todo e a pessoa esteve fora do
--                     quadro em parte dele. `interrupted` e perda de fonte;
--                     este e a fonte inteira com o corpo fora dela.
-- ---------------------------------------------------------------------------

alter table public.session_modality_coverage
  drop constraint if exists session_modality_coverage_modality_check;
alter table public.session_modality_coverage
  add constraint session_modality_coverage_modality_check
  check (modality in (
    'screen', 'camera', 'microphone',
    'visual_face', 'visual_body', 'visual_hands'
  ));

alter table public.session_modality_coverage
  drop constraint if exists session_modality_coverage_reason_check;
alter table public.session_modality_coverage
  add constraint session_modality_coverage_reason_check
  check (reason is null or reason in (
    'not_requested', 'unsupported', 'denied', 'cancelled', 'error',
    'not_observed',
    'interrupted', 'recording_capped', 'out_of_frame'
  ));

alter table public.session_modality_coverage
  drop constraint if exists session_modality_coverage_reason_domain;
alter table public.session_modality_coverage
  add constraint session_modality_coverage_reason_domain check (
    outcome = 'full'
    or (outcome = 'partial'
        and reason in ('interrupted', 'recording_capped', 'out_of_frame'))
    or (outcome = 'absent' and reason in (
      'not_requested', 'unsupported', 'denied', 'cancelled', 'error',
      'not_observed'
    ))
  );

alter table public.session_modality_coverage
  drop constraint if exists session_modality_coverage_extractor_version_check;
alter table public.session_modality_coverage
  add constraint session_modality_coverage_extractor_version_check
  check (extractor_version in (
    'elyra-signals/v1', 'elyra-signals/v2', 'elyra-signals/v3', 'elyra-visual/v1'
  ));

-- ---------------------------------------------------------------------------
-- 3. Sinais visuais em `derived_features`
--
-- Cinco nomes novos, todos `index` normalizado em 0-1. Cada um descreve **a
-- medida**: "frequencia de movimento da cabeca" e a fracao de amostras em que a
-- orientacao mudou acima de um limiar. Nao e agitacao, nao e ansiedade, nao e
-- desinteresse - e por isso nenhuma dessas palavras entra nesta lista, agora ou
-- depois.
--
-- `movement_frequency` continua no vocabulario e nao e substituido: ele mede
-- mudanca de pixel na cena inteira, que e outra coisa, e sessoes anteriores
-- dependem dele.
-- ---------------------------------------------------------------------------

alter table public.derived_features
  drop constraint if exists derived_features_signal_name_check;
alter table public.derived_features
  add constraint derived_features_signal_name_check
  check (signal_name in (
    'speech_rate',
    'pause_count',
    'pause_total_duration',
    'pause_mean_duration',
    'vocal_variation',
    'movement_frequency',
    'head_movement_frequency',
    'head_motion_amplitude',
    'body_movement_frequency',
    'body_motion_amplitude',
    'hand_movement_frequency'
  ));

alter table public.derived_features
  drop constraint if exists derived_feature_unit_matches_signal;
alter table public.derived_features
  add constraint derived_feature_unit_matches_signal check (
    (signal_name = 'speech_rate' and unit = 'words_per_minute')
    or (signal_name = 'pause_count' and unit = 'count')
    or (signal_name in ('pause_total_duration', 'pause_mean_duration')
        and unit = 'milliseconds')
    or (signal_name in (
          'vocal_variation', 'movement_frequency',
          'head_movement_frequency', 'head_motion_amplitude',
          'body_movement_frequency', 'body_motion_amplitude',
          'hand_movement_frequency'
        ) and unit = 'index')
  );

-- `elyra-visual/v1` e versao **propria**, e nao continuacao de `elyra-signals`:
-- a aritmetica visual nao tem nada em comum com a de audio e vai evoluir em
-- ritmo proprio. Cada linha carrega a versao do extrator que a produziu, e por
-- isso as duas convivem na mesma tabela sem ambiguidade.
alter table public.derived_features
  drop constraint if exists derived_features_extractor_version_check;
alter table public.derived_features
  add constraint derived_features_extractor_version_check
  check (extractor_version in (
    'elyra-signals/v1', 'elyra-signals/v2', 'elyra-signals/v3', 'elyra-visual/v1'
  ));

-- ---------------------------------------------------------------------------
-- 4. Janelas visuais
--
-- Mesmo vocabulario fechado, mesma retencao de 7 dias da Era 4: detalhe temporal
-- expira junto com a midia bruta. Uma serie por minuto de movimento de cabeca e
-- mais reveladora que o agregado da sessao, e nao ha razao para ela sobreviver
-- mais tempo que o resto do detalhe.
-- ---------------------------------------------------------------------------

alter table public.session_signal_windows
  drop constraint if exists session_signal_windows_signal_name_check;
alter table public.session_signal_windows
  add constraint session_signal_windows_signal_name_check
  check (signal_name in (
    'pause_count',
    'pause_total_duration',
    'pause_mean_duration',
    'vocal_variation',
    'movement_frequency',
    'head_movement_frequency',
    'head_motion_amplitude',
    'body_movement_frequency',
    'body_motion_amplitude',
    'hand_movement_frequency'
  ));

alter table public.session_signal_windows
  drop constraint if exists session_signal_windows_extractor_version_check;
alter table public.session_signal_windows
  add constraint session_signal_windows_extractor_version_check
  check (extractor_version in (
    'elyra-signals/v1', 'elyra-signals/v2', 'elyra-signals/v3', 'elyra-visual/v1'
  ));

-- ---------------------------------------------------------------------------
-- 5. A trava de consentimento, em trigger e nao em `check`
--
-- A invariante e: **nada derivado de landmark existe sem
-- `visual_analysis_consent`.** Ela atravessa tabelas - a linha esta em
-- `derived_features`, o consentimento esta em `multimodal_sessions` - e um
-- `check` do PostgreSQL nao aceita subconsulta. Escrever `exists (select ...)`
-- dentro de `check` nao produz uma regra fraca: produz erro de sintaxe, e a
-- migration nem aplica.
--
-- Trigger `before insert or update`, entao. E `security definer` com
-- `search_path` fixo, porque ela le uma tabela sob RLS: sem isso a checagem
-- enxergaria nada e **aprovaria tudo** - uma trava fail-open, que e pior que
-- trava nenhuma por parecer que existe.
--
-- Isto **complementa** a RLS, e nao a substitui. A RLS decide de quem e a linha;
-- esta trava decide se a linha pode existir.
-- ---------------------------------------------------------------------------

create or replace function public.assert_visual_row_consent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  consented boolean;
  payload jsonb;
  name_value text;
begin
  /*
    `to_jsonb(new)`, e nao `new.<coluna>`.

    A primeira versao lia `new.reason` numa condicao guardada por
    `tg_argv[0] = 'modality'`. PL/pgSQL **resolve a referencia de campo ao
    executar a expressao inteira**, entao a trava explodia com
    `record "new" has no field "reason"` nas duas tabelas de sinal - inclusive
    no caminho legitimo, com consentimento dado. A trava de privacidade
    derrubava exatamente o dado que ela deveria deixar passar.

    `to_jsonb` e agnostico de forma: campo ausente devolve `null` em vez de
    erro, e a mesma funcao serve as tres tabelas sem SQL dinamico.
  */
  payload := to_jsonb(new);
  name_value := payload ->> tg_argv[0];

  if name_value is null or name_value not in (
    'head_movement_frequency', 'head_motion_amplitude',
    'body_movement_frequency', 'body_motion_amplitude',
    'hand_movement_frequency',
    'visual_face', 'visual_body', 'visual_hands'
  ) then
    return new;
  end if;

  -- Cobertura `not_requested` e o registro de que a analise **nao** foi
  -- autorizada. Recusa-la exigiria consentimento para dizer que nao houve
  -- consentimento.
  if tg_argv[0] = 'modality' and payload ->> 'reason' = 'not_requested' then
    return new;
  end if;

  select session.visual_analysis_consent
    into consented
    from public.multimodal_sessions session
   where session.id = new.session_id;

  -- Sessao inexistente e problema da foreign key, nao desta trava: deixar
  -- passar aqui mantem a mensagem de erro no lugar certo.
  if consented is not null and not consented then
    raise exception
      'VISUAL_ANALYSIS_WITHOUT_CONSENT: % sem visual_analysis_consent', name_value
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.assert_visual_row_consent() from public, anon;

drop trigger if exists derived_features_visual_consent on public.derived_features;
create trigger derived_features_visual_consent
before insert or update on public.derived_features
for each row execute function public.assert_visual_row_consent('signal_name');

drop trigger if exists session_signal_windows_visual_consent
  on public.session_signal_windows;
create trigger session_signal_windows_visual_consent
before insert or update on public.session_signal_windows
for each row execute function public.assert_visual_row_consent('signal_name');

drop trigger if exists session_modality_coverage_visual_consent
  on public.session_modality_coverage;
create trigger session_modality_coverage_visual_consent
before insert or update on public.session_modality_coverage
for each row execute function public.assert_visual_row_consent('modality');
