begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(34);

select has_table('public', 'cycle_profiles', 'perfil do ciclo existe');
select has_table('public', 'cycle_periods', 'periodos existem');
select has_table('public', 'cycle_daily_records', 'registros diarios existem');
select has_table('public', 'cycle_symptoms', 'catalogo de sintomas existe');
select has_table('public', 'cycle_daily_symptoms', 'join diario/sintoma existe');

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.cycle_profiles'::regclass), 'perfil usa RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.cycle_periods'::regclass), 'periodos usam RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.cycle_daily_records'::regclass), 'registros usam RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.cycle_symptoms'::regclass), 'sintomas usam RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.cycle_daily_symptoms'::regclass), 'join usa RLS forcada');

select has_trigger('public', 'cycle_profiles', 'cycle_profiles_audit_write', 'opt-in gera audit sanitizado');
select has_trigger('public', 'cycle_periods', 'cycle_periods_audit_write', 'periodo gera audit sanitizado');
select has_trigger('public', 'cycle_daily_records', 'cycle_daily_records_audit_write', 'registro gera audit sanitizado');
select has_trigger('public', 'cycle_symptoms', 'cycle_symptoms_audit_write', 'sintoma custom gera audit sanitizado');

select is((select count(*)::integer from public.cycle_symptoms where origin = 'system'), 6, 'catalogo system tem seis sintomas');
select ok(
  (select cardinality(indkey) = 2 from pg_index where indrelid = 'public.cycle_daily_symptoms'::regclass and indisprimary),
  'join diario/sintoma usa PK composta'
);
select ok(exists (select 1 from pg_constraint where conrelid = 'public.cycle_profiles'::regclass and conname = 'cycle_profile_optin_shape'), 'perfil ativo exige opt-in');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.cycle_periods'::regclass and conname = 'cycle_period_end_after_start'), 'fim do periodo nao antecede inicio');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.cycle_daily_records'::regclass and conname = 'cycle_daily_user_date_unique'), 'um registro por usuario/data');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.cycle_daily_records'::regclass and conname = 'cycle_daily_records_flow_check'), 'fluxo usa catalogo fechado');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.cycle_symptoms'::regclass and conname = 'cycle_symptom_owner_shape'), 'sintoma trava shape system/custom');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.cycle_daily_symptoms'::regclass and conname = 'cycle_daily_symptoms_severity_check'), 'severidade usa catalogo fechado');

select has_function('public', 'set_cycle_enabled', array['boolean'], 'RPC de opt-in existe');
select has_function('public', 'save_cycle_period', array['jsonb'], 'RPC de periodo existe');
select has_function('public', 'save_cycle_daily_record', array['jsonb'], 'RPC de registro diario existe');
select has_function('public', 'delete_cycle_data', array[]::text[], 'RPC de exclusao separada existe');

select ok(
  not has_table_privilege('anon', 'public.cycle_profiles', 'SELECT')
  and not has_table_privilege('anon', 'public.cycle_periods', 'SELECT')
  and not has_table_privilege('anon', 'public.cycle_daily_records', 'SELECT')
  and not has_table_privilege('anon', 'public.cycle_symptoms', 'SELECT')
  and not has_table_privilege('anon', 'public.cycle_daily_symptoms', 'SELECT'),
  'anon nao recebe leitura da Stage 07'
);
select ok(not has_table_privilege('authenticated', 'public.cycle_profiles', 'UPDATE'), 'perfil muda apenas pela RPC de opt-in');
select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename in ('cycle_profiles', 'cycle_periods', 'cycle_daily_records', 'cycle_symptoms', 'cycle_daily_symptoms') and policyname not like '%professional%'),
  15,
  'quinze policies explicitas protegem a Stage 07'
);
select has_index('public', 'cycle_periods', 'cycle_periods_user_start_idx', 'periodos usam indice owner/data');
select has_index('public', 'cycle_daily_records', 'cycle_daily_records_user_date_idx', 'registros usam indice owner/data');
select ok((select prosecdef from pg_proc where oid = 'public.set_cycle_enabled(boolean)'::regprocedure), 'RPC de opt-in encapsula escrita do perfil');
select ok(not (select prosecdef from pg_proc where oid = 'public.save_cycle_daily_record(jsonb)'::regprocedure), 'RPC diaria permanece sujeita a RLS');
select ok(
  not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.cycle_daily_symptoms'::regclass and not tgisinternal
  ),
  'join nao gera audit com severidade autorrelatada'
);

select * from finish();
rollback;
