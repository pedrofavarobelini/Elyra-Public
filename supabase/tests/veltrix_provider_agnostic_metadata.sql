begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

-- ADR-0034: provider_used/model sao metadata do Veltrix. O banco fecha o
-- FORMATO e recusa pseudo-providers; nao codifica a lista de providers.

select plan(22);

-- As constraints reais sao copiadas para uma tabela de prova sem FK/unique.
-- Assim o teste exercita o predicado instalado pela migration, e nao uma
-- copia reescrita dele.
create temp table insight_probe (
  like public.ai_insights including constraints including defaults
);

create function pg_temp.insert_insight(p_provider text, p_model text)
returns void language plpgsql as $$
declare
  v_correlation uuid := gen_random_uuid();
begin
  insert into insight_probe (
    id, user_id, report_snapshot_id, correlation_id,
    idempotency_key_fingerprint, request_fingerprint,
    provider_used, model, output
  ) values (
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), v_correlation,
    repeat('a', 64), repeat('b', 64),
    p_provider, p_model,
    jsonb_build_object(
      'contractVersion', 'elyra-textual/v1',
      'outputSchemaVersion', 'elyra-textual-output/v1',
      'operation', 'interpret_deterministic_report',
      'sourceReportSchemaVersion', 'report_snapshot/v1',
      'sourceAnalyticsVersion', 'elyra-analytics/v1',
      'correlationId', v_correlation::text
    )
  );
end;
$$;

-- Linhas ja existentes continuam validas ----------------------------------

select lives_ok($$ select pg_temp.insert_insight('mock', 'mock-v1') $$,
  'mock/mock-v1 continua aceito');
select lives_ok($$ select pg_temp.insert_insight('gemini', 'gemini-3.5-flash') $$,
  'gemini/gemini-3.5-flash continua aceito');

-- Provider homologado pelo Veltrix nao exige migration nova ----------------

select lives_ok($$ select pg_temp.insert_insight('claude', 'claude-sonnet-4-5') $$,
  'claude aceito sem mudanca de banco');
select lives_ok($$ select pg_temp.insert_insight('openai', 'gpt-5.2-mini') $$,
  'openai aceito sem mudanca de banco');
select lives_ok($$ select pg_temp.insert_insight('grok', 'grok-4.3') $$,
  'grok aceito sem mudanca de banco');
select lives_ok($$ select pg_temp.insert_insight('deepseek', 'deepseek-chat') $$,
  'deepseek aceito sem mudanca de banco');

-- Mock continua amarrado ao modelo simulado --------------------------------

select throws_ok($$ select pg_temp.insert_insight('mock', 'gemini-3.5-flash') $$,
  '23514', null, 'mock com modelo real e recusado');
select throws_ok($$ select pg_temp.insert_insight('gemini', 'mock-v1') $$,
  '23514', null, 'provider real declarando modelo simulado e recusado');

-- Pseudo-providers nunca viram inferencia registrada -----------------------

select throws_ok($$ select pg_temp.insert_insight('none', 'none') $$,
  '23514', null, 'none e recusado');
select throws_ok($$ select pg_temp.insert_insight('unknown', 'x') $$,
  '23514', null, 'unknown e recusado');
select throws_ok($$ select pg_temp.insert_insight('auto', 'auto') $$,
  '23514', null, 'auto e pedido, nao provider usado');
select throws_ok($$ select pg_temp.insert_insight('local_qa', 'local-qa-v1') $$,
  '23514', null, 'local_qa e recusado');
select throws_ok($$ select pg_temp.insert_insight('local_model', 'local-model') $$,
  '23514', null, 'local_model e recusado');

-- Formato fechado ------------------------------------------------------------

select throws_ok($$ select pg_temp.insert_insight('Gemini', 'gemini-3.5-flash') $$,
  '23514', null, 'identificador fora do formato e recusado');
select throws_ok($$ select pg_temp.insert_insight('', '') $$,
  '23514', null, 'provider vazio e recusado');
select throws_ok($$ select pg_temp.insert_insight('gemini', '') $$,
  '23514', null, 'modelo vazio e recusado');
select throws_ok($$ select pg_temp.insert_insight('gemini', ' drop table') $$,
  '23514', null, 'modelo fora do formato e recusado');
select throws_ok($$ select pg_temp.insert_insight('gemini', repeat('m', 81)) $$,
  '23514', null, 'modelo acima de 80 caracteres e recusado');

-- Garantias vizinhas nao foram afrouxadas -------------------------------------

select ok(
  (select pg_get_constraintdef(oid) ilike '%fallback_used = false%'
   from pg_constraint
   where conrelid = 'public.ai_insights'::regclass
     and conname = 'ai_insights_fallback_used_check'),
  'fallback silencioso continua proibido'
);
select ok(
  (select pg_get_constraintdef(oid) not ilike '%gemini%'
   from pg_constraint
   where conrelid = 'public.ai_insights'::regclass
     and conname = 'ai_insights_provider_used_check'),
  'ai_insights nao codifica nome de provider'
);
select ok(
  (select pg_get_constraintdef(oid) not ilike '%gemini%'
     and pg_get_constraintdef(oid) ilike '%local_model%'
   from pg_constraint
   where conrelid = 'public.session_interpretations'::regclass
     and conname = 'session_interpretations_provider_used_check'),
  'session_interpretations usa formato fechado sem nome de provider'
);
select ok(
  (select pg_get_constraintdef(oid) ilike '%char_length(model)%'
   from pg_constraint
   where conrelid = 'public.session_interpretations'::regclass
     and conname = 'session_interpretations_model_check'),
  'session_interpretations continua limitando o modelo'
);

select * from finish();

rollback;
