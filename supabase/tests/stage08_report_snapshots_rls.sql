begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

select has_table('public', 'report_snapshots', 'snapshots de relatorio existem');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.report_snapshots'::regclass),
  'snapshots usam RLS forcada'
);
select has_trigger('public', 'report_snapshots', 'report_snapshots_audit_insert', 'snapshot gera audit sanitizado');
select has_index('public', 'report_snapshots', 'report_snapshots_user_created_idx', 'snapshots usam indice owner/tempo');

select ok(not has_table_privilege('anon', 'public.report_snapshots', 'SELECT'), 'anon nao recebe snapshot');
select ok(has_table_privilege('authenticated', 'public.report_snapshots', 'SELECT'), 'owner pode ler snapshot');
select ok(has_table_privilege('authenticated', 'public.report_snapshots', 'INSERT'), 'owner pode criar snapshot');
select ok(not has_table_privilege('authenticated', 'public.report_snapshots', 'UPDATE'), 'snapshot nao permite update');
select ok(not has_table_privilege('authenticated', 'public.report_snapshots', 'DELETE'), 'snapshot nao permite delete');

select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'report_snapshots' and policyname not like '%professional%'),
  2,
  'duas policies explicitas: select e insert owner-only'
);
select ok(exists (select 1 from pg_constraint where conrelid = 'public.report_snapshots'::regclass and conname = 'report_snapshots_schema_version_check'), 'schema version e fechado');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.report_snapshots'::regclass and conname = 'report_snapshots_analytics_version_check'), 'analytics version e fechado');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.report_snapshots'::regclass and conname = 'report_snapshots_cycle_heuristic_version_check'), 'heuristica de ciclo e versionada');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.report_snapshots'::regclass and conname = 'report_snapshot_range_shape'), 'range confere com boundaries');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.report_snapshots'::regclass and conname = 'report_snapshots_payload_check'), 'payload exige objeto JSON');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.report_snapshots'::regclass and contype = 'f'), 'snapshot referencia auth user');
select ok((select prosecdef from pg_proc where oid = 'public.audit_stage08_snapshot_insert()'::regprocedure), 'audit encapsulado por security definer');

select * from finish();
rollback;
