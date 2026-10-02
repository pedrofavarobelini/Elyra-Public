begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(31);

select has_table('public', 'emotional_checkins', 'emotional_checkins existe');
select has_table('public', 'emotional_factors', 'emotional_factors existe');
select has_table('public', 'emotional_checkin_factors', 'join emocional existe');
select has_table('public', 'sleep_records', 'sleep_records existe');

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.emotional_checkins'::regclass), 'checkins usa RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.emotional_factors'::regclass), 'factors usa RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.emotional_checkin_factors'::regclass), 'join usa RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.sleep_records'::regclass), 'sleep usa RLS forcada');

select has_trigger('public', 'emotional_checkins', 'emotional_checkins_reject_future', 'trigger recusa futuro');
select has_trigger('public', 'sleep_records', 'sleep_records_set_updated_at', 'sleep atualiza timestamp');
select has_trigger('public', 'emotional_checkins', 'emotional_checkins_audit_insert', 'checkin gera audit');
select has_trigger('public', 'emotional_factors', 'emotional_factors_audit_insert', 'factor gera audit');
select has_trigger('public', 'sleep_records', 'sleep_records_audit_write', 'sleep gera audit');

select is((select count(*)::integer from public.emotional_factors where origin = 'system'), 8, 'catalogo system tem oito fatores');
select ok(
  (select cardinality(indkey) = 2 from pg_index where indrelid = 'public.emotional_checkin_factors'::regclass and indisprimary),
  'join usa PK composta de duas colunas'
);
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.emotional_checkins'::regclass and conname = 'emotional_checkin_has_value'),
  'checkin exige valor emocional'
);
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.emotional_factors'::regclass and conname = 'emotional_factor_owner_shape'),
  'factor trava shape system/custom'
);
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.sleep_records'::regclass and conname = 'sleep_record_has_value'),
  'sleep exige duracao ou qualidade'
);
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.sleep_records'::regclass and conname = 'sleep_record_user_night_unique'),
  'sleep e unico por owner/data civil'
);
select has_function('public', 'create_emotional_checkin', array['jsonb'], 'RPC atomica existe');

select ok(
  not has_table_privilege('anon', 'public.emotional_checkins', 'SELECT')
  and not has_table_privilege('anon', 'public.emotional_factors', 'SELECT')
  and not has_table_privilege('anon', 'public.emotional_checkin_factors', 'SELECT')
  and not has_table_privilege('anon', 'public.sleep_records', 'SELECT'),
  'anon nao recebe SELECT emocional'
);
-- Era 2 / ADR-0007: o check-in passou a ser editavel pelo proprio dono. A
-- asseracao antiga afirmava apenas que ninguem podia editar; esta prova quem
-- pode - e que apagar continua fora deste caminho.
select ok(has_table_privilege('authenticated', 'public.emotional_checkins', 'UPDATE'), 'checkin e editavel pelo dono');
select ok(not has_table_privilege('authenticated', 'public.emotional_checkins', 'DELETE'), 'editar nao concede apagar');
select ok(not has_table_privilege('anon', 'public.emotional_checkins', 'UPDATE'), 'anon nao edita check-in');
select has_function('public', 'update_emotional_checkin', array['jsonb'], 'RPC de correcao existe');
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'emotional_checkins'
      and policyname = 'emotional_checkins_update_own'
      and qual is not null and with_check is not null
  ),
  'policy de update exige using E with check'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'emotional_checkin_factors'
      and policyname = 'emotional_checkin_factors_delete_own'
  ),
  'trocar fatores exige policy de delete propria'
);
select ok(not has_table_privilege('authenticated', 'public.emotional_factors', 'UPDATE'), 'factor nao e mutavel');
select ok(has_table_privilege('authenticated', 'public.sleep_records', 'UPDATE'), 'sleep permite upsert proprio');
select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename in ('emotional_checkins', 'emotional_factors', 'emotional_checkin_factors', 'sleep_records') and policyname not like '%professional%'),
  11,
  'onze policies emocionais explicitas (duas novas na Era 2)'
);
select has_index('public', 'emotional_checkins', 'emotional_checkins_user_time_idx', 'historico usa indice owner/tempo');

select * from finish();
rollback;
