begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

-- ---------------------------------------------------------------------------
-- Duas sessoes da mesma pessoa, identicas exceto pelo consentimento visual.
-- Toda a diferenca observada adiante vem dessa unica coluna.
-- ---------------------------------------------------------------------------

insert into public.multimodal_sessions (
  id, user_id, kind, status, camera_consent, microphone_consent, visual_analysis_consent
) values (
  '95000000-0000-4000-8000-0000000000a1',
  '10000000-0000-4000-8000-000000000001',
  'guided', 'completed', true, true, true
), (
  '95000000-0000-4000-8000-0000000000a2',
  '10000000-0000-4000-8000-000000000001',
  'guided', 'completed', true, true, false
);

-- ---------------------------------------------------------------------------
-- 1. Consentimento
-- ---------------------------------------------------------------------------

select is(
  (select visual_analysis_consent
     from public.multimodal_sessions
    where id = '95000000-0000-4000-8000-0000000000a2'),
  false,
  'consentimento de analise visual nasce desligado'
);

select throws_ok(
  $$insert into public.multimodal_sessions
      (user_id, kind, microphone_consent, camera_consent, visual_analysis_consent)
    values ('10000000-0000-4000-8000-000000000001',
            'guided', true, false, true)$$,
  '23514',
  null,
  'analise visual sem camera e recusada pelo banco'
);

-- ---------------------------------------------------------------------------
-- 2. Vocabulario fechado: emocao nao tem nome
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.derived_features
      (session_id, user_id, signal_name, unit, value, status)
    values ('95000000-0000-4000-8000-0000000000a1',
            '10000000-0000-4000-8000-000000000001',
            'anxiety_level', 'index', 0.9, 'insufficient_baseline')$$,
  '23514',
  null,
  'nome de emocao nao entra no vocabulario de sinais'
);

select throws_ok(
  $$insert into public.derived_features
      (session_id, user_id, signal_name, unit, value, status)
    values ('95000000-0000-4000-8000-0000000000a1',
            '10000000-0000-4000-8000-000000000001',
            'stress_score', 'index', 0.5, 'insufficient_baseline')$$,
  '23514',
  null,
  'score de stress nao entra no vocabulario de sinais'
);

select throws_ok(
  $$insert into public.derived_features
      (session_id, user_id, signal_name, unit, value, status)
    values ('95000000-0000-4000-8000-0000000000a1',
            '10000000-0000-4000-8000-000000000001',
            'gaze_attention', 'index', 0.5, 'insufficient_baseline')$$,
  '23514',
  null,
  'gaze continua sem nome: NOT_APPROVED nao vira aprovado por haver modelo'
);

-- ---------------------------------------------------------------------------
-- 3. Os cinco sinais visuais existem, com consentimento
-- ---------------------------------------------------------------------------

select lives_ok(
  $$insert into public.derived_features
      (session_id, user_id, signal_name, unit, value, status, extractor_version)
    values
      ('95000000-0000-4000-8000-0000000000a1',
       '10000000-0000-4000-8000-000000000001',
       'head_movement_frequency', 'index', 0.4, 'insufficient_baseline',
       'elyra-visual/v1'),
      ('95000000-0000-4000-8000-0000000000a1',
       '10000000-0000-4000-8000-000000000001',
       'head_motion_amplitude', 'index', 0.2, 'insufficient_baseline',
       'elyra-visual/v1'),
      ('95000000-0000-4000-8000-0000000000a1',
       '10000000-0000-4000-8000-000000000001',
       'body_movement_frequency', 'index', 0.3, 'insufficient_baseline',
       'elyra-visual/v1'),
      ('95000000-0000-4000-8000-0000000000a1',
       '10000000-0000-4000-8000-000000000001',
       'body_motion_amplitude', 'index', 0.1, 'insufficient_baseline',
       'elyra-visual/v1'),
      ('95000000-0000-4000-8000-0000000000a1',
       '10000000-0000-4000-8000-000000000001',
       'hand_movement_frequency', 'index', 0.6, 'insufficient_baseline',
       'elyra-visual/v1')$$,
  'os cinco sinais visuais sao aceitos com consentimento'
);

select is(
  (select count(*)::integer
     from public.derived_features
    where session_id = '95000000-0000-4000-8000-0000000000a1'
      and extractor_version = 'elyra-visual/v1'),
  5,
  'sinal visual carrega a versao do extrator visual, e nao a de audio'
);

select throws_ok(
  $$insert into public.derived_features
      (session_id, user_id, signal_name, unit, value, status, extractor_version)
    values ('95000000-0000-4000-8000-0000000000a1',
            '10000000-0000-4000-8000-000000000001',
            'head_movement_frequency', 'count', 3, 'insufficient_baseline',
            'elyra-visual/v1')$$,
  '23514',
  null,
  'sinal visual em unidade que nao e index e recusado'
);

-- ---------------------------------------------------------------------------
-- 4. A trava de consentimento, atravessando tabelas
--
-- Esta e a razao de a trava ser trigger e nao `check`: a linha esta numa tabela
-- e o consentimento esta em outra, e `check` do PostgreSQL nao aceita
-- subconsulta.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.derived_features
      (session_id, user_id, signal_name, unit, value, status, extractor_version)
    values ('95000000-0000-4000-8000-0000000000a2',
            '10000000-0000-4000-8000-000000000001',
            'head_movement_frequency', 'index', 0.4, 'insufficient_baseline',
            'elyra-visual/v1')$$,
  '23514',
  null,
  'sinal visual sem consentimento visual e recusado'
);

select throws_ok(
  $$insert into public.session_signal_windows
      (session_id, user_id, signal_name, start_offset_ms, end_offset_ms, value,
       extractor_version)
    values ('95000000-0000-4000-8000-0000000000a2',
            '10000000-0000-4000-8000-000000000001',
            'body_movement_frequency', 0, 60000, 0.2, 'elyra-visual/v1')$$,
  '23514',
  null,
  'janela visual sem consentimento visual e recusada'
);

select throws_ok(
  $$insert into public.session_modality_coverage
      (session_id, user_id, modality, outcome, reason, coverage_ms,
       session_duration_ms)
    values ('95000000-0000-4000-8000-0000000000a2',
            '10000000-0000-4000-8000-000000000001',
            'visual_face', 'partial', 'out_of_frame', 60000, 120000)$$,
  '23514',
  null,
  'cobertura visual sem consentimento visual e recusada'
);

-- `not_requested` e o registro de que a analise **nao** foi autorizada. Recusa-la
-- exigiria consentimento para dizer que nao houve consentimento.
select lives_ok(
  $$insert into public.session_modality_coverage
      (session_id, user_id, modality, outcome, reason, coverage_ms,
       session_duration_ms)
    values ('95000000-0000-4000-8000-0000000000a2',
            '10000000-0000-4000-8000-000000000001',
            'visual_body', 'absent', 'not_requested', 0, 120000)$$,
  'cobertura not_requested e aceita mesmo sem consentimento visual'
);

-- A trava nao pode vazar para o audio: sinal de audio numa sessao sem
-- consentimento visual continua valido.
select lives_ok(
  $$insert into public.derived_features
      (session_id, user_id, signal_name, unit, value, status, extractor_version)
    values ('95000000-0000-4000-8000-0000000000a2',
            '10000000-0000-4000-8000-000000000001',
            'vocal_variation', 'index', 0.4, 'insufficient_baseline',
            'elyra-signals/v2')$$,
  'sinal de audio nao e afetado pela trava visual'
);

-- ---------------------------------------------------------------------------
-- 5. Cobertura visual: os dois motivos que so o visual precisou
-- ---------------------------------------------------------------------------

select lives_ok(
  $$insert into public.session_modality_coverage
      (session_id, user_id, modality, outcome, reason, coverage_ms,
       session_duration_ms)
    values
      ('95000000-0000-4000-8000-0000000000a1',
       '10000000-0000-4000-8000-000000000001',
       'visual_face', 'partial', 'out_of_frame', 60000, 120000),
      ('95000000-0000-4000-8000-0000000000a1',
       '10000000-0000-4000-8000-000000000001',
       'visual_body', 'absent', 'not_observed', 0, 120000)$$,
  'out_of_frame e not_observed sao motivos validos de cobertura visual'
);

select throws_ok(
  $$insert into public.session_modality_coverage
      (session_id, user_id, modality, outcome, reason, coverage_ms,
       session_duration_ms)
    values ('95000000-0000-4000-8000-0000000000a1',
            '10000000-0000-4000-8000-000000000001',
            'visual_hands', 'absent', 'out_of_frame', 0, 120000)$$,
  '23514',
  null,
  'motivo de cobertura parcial nao serve para ausencia'
);

-- Inicio tardio da analise: a sessao comecou, o motor ainda estava carregando, e
-- o trecho anterior nao foi observado por ninguem. Nao e interrupcao (a fonte
-- nao se perdeu), nao e enquadramento (nao havia fonte para a pessoa estar
-- dentro ou fora) e nao e ausencia (houve observacao, so que menor).
select lives_ok(
  $$insert into public.session_modality_coverage
      (session_id, user_id, modality, outcome, reason, coverage_ms,
       session_duration_ms)
    values ('95000000-0000-4000-8000-0000000000a1',
            '10000000-0000-4000-8000-000000000001',
            'visual_hands', 'partial', 'analysis_started_late', 55000, 60000)$$,
  'analysis_started_late e motivo valido de cobertura parcial'
);

select throws_ok(
  $$insert into public.session_modality_coverage
      (session_id, user_id, modality, outcome, reason, coverage_ms,
       session_duration_ms)
    values ('95000000-0000-4000-8000-0000000000a2',
            '10000000-0000-4000-8000-000000000001',
            'visual_face', 'absent', 'analysis_started_late', 0, 60000)$$,
  '23514',
  null,
  'analysis_started_late nao serve para ausencia'
);

-- A trava e `security definer` de proposito: sem isso ela leria uma tabela sob
-- RLS, enxergaria nada e **aprovaria tudo** - fail-open disfarcado de trava.
select ok(
  (select p.prosecdef
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'assert_visual_row_consent'),
  'a trava de consentimento visual roda como security definer'
);

select * from finish();
rollback;
