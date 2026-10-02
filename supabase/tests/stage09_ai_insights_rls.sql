begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(25);

select has_table('public', 'ai_insights', 'ai_insights existe');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.ai_insights'::regclass),
  'ai_insights usa RLS forcada'
);
select has_trigger('public', 'ai_insights', 'ai_insights_audit_insert', 'insight gera audit sanitizado');
select has_index('public', 'ai_insights', 'ai_insights_snapshot_created_idx', 'insight indexa snapshot e tempo');

select ok(not has_table_privilege('anon', 'public.ai_insights', 'SELECT'), 'anon nao le insight');
select ok(has_table_privilege('authenticated', 'public.ai_insights', 'SELECT'), 'owner pode ler insight');
select ok(has_table_privilege('authenticated', 'public.ai_insights', 'INSERT'), 'owner pode criar insight');
select ok(not has_table_privilege('authenticated', 'public.ai_insights', 'UPDATE'), 'insight nao permite update');
select ok(not has_table_privilege('authenticated', 'public.ai_insights', 'DELETE'), 'insight nao permite delete');

select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'ai_insights'),
  2,
  'duas policies explicitas: select e insert owner-only'
);
select ok(exists (select 1 from pg_constraint where conrelid = 'public.ai_insights'::regclass and conname = 'ai_insights_snapshot_owner_fkey'), 'FK vincula snapshot e owner');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.ai_insights'::regclass and conname = 'ai_insights_contract_version_check'), 'contrato e fechado');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.ai_insights'::regclass and conname = 'ai_insights_output_schema_version_check'), 'output schema e fechado');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.ai_insights'::regclass and conname = 'ai_insights_operation_check'), 'operacao e fechada');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.ai_insights'::regclass and conname = 'ai_insights_provider_model_check'), 'provider/model e fechado');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.ai_insights'::regclass and conname = 'ai_insights_fallback_used_check'), 'fallback silencioso e proibido');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.ai_insights'::regclass and conname = 'ai_insights_output_contract_check'), 'output JSON confere versao e correlation');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.ai_insights'::regclass and conname = 'ai_insights_user_idempotency_unique'), 'idempotencia local e unica por usuario');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.ai_insights'::regclass and conname = 'ai_insights_user_correlation_unique'), 'correlation e unica por usuario');
select ok((select prosecdef from pg_proc where oid = 'public.audit_stage09_ai_insight_insert()'::regprocedure), 'audit usa security definer');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.report_snapshots'::regclass and conname = 'report_snapshots_id_user_unique'), 'snapshot expoe chave composta de ownership');
select ok(not has_table_privilege('authenticated', 'public.report_snapshots', 'UPDATE'), 'snapshot fonte permanece imutavel');
select has_function('public', 'set_ai_inference_consent', array['boolean'], 'consent gate versionado existe');
select ok(has_function_privilege('authenticated', 'public.set_ai_inference_consent(boolean)', 'EXECUTE'), 'authenticated pode decidir consentimento proprio');
select ok(not has_function_privilege('anon', 'public.set_ai_inference_consent(boolean)', 'EXECUTE'), 'anon nao decide consentimento');

select * from finish();
rollback;
