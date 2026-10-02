begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(45);

select has_table('public', 'professional_profiles', 'professional_profiles existe');
select has_table('public', 'professional_connections', 'professional_connections existe');
select has_table('public', 'sharing_permissions', 'sharing_permissions existe');
select has_table('public', 'professional_notes', 'professional_notes existe');

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.professional_profiles'::regclass), 'professional_profiles usa RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.professional_connections'::regclass), 'professional_connections usa RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.sharing_permissions'::regclass), 'sharing_permissions usa RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.professional_notes'::regclass), 'professional_notes usa RLS forcada');

select ok(
  not has_table_privilege('anon', 'public.professional_profiles', 'SELECT')
  and not has_table_privilege('anon', 'public.professional_connections', 'SELECT')
  and not has_table_privilege('anon', 'public.sharing_permissions', 'SELECT')
  and not has_table_privilege('anon', 'public.professional_notes', 'SELECT'),
  'anon nao le dominio profissional'
);
select ok(
  has_table_privilege('authenticated', 'public.professional_profiles', 'SELECT')
  and has_table_privilege('authenticated', 'public.professional_connections', 'SELECT')
  and has_table_privilege('authenticated', 'public.sharing_permissions', 'SELECT')
  and has_table_privilege('authenticated', 'public.professional_notes', 'SELECT'),
  'authenticated recebe somente leitura governada nas entidades de controle'
);
select ok(not has_table_privilege('authenticated', 'public.professional_profiles', 'INSERT'), 'perfil profissional nao aceita insert direto');
select ok(not has_table_privilege('authenticated', 'public.professional_connections', 'INSERT'), 'connection nao aceita insert direto');
select ok(not has_table_privilege('authenticated', 'public.sharing_permissions', 'INSERT'), 'permission nao aceita insert direto');
select ok(
  has_table_privilege('authenticated', 'public.professional_notes', 'INSERT')
  and has_table_privilege('authenticated', 'public.professional_notes', 'UPDATE')
  and has_table_privilege('authenticated', 'public.professional_notes', 'DELETE'),
  'nota permite escrita somente sob RLS profissional'
);

select ok(exists (select 1 from pg_constraint where conrelid = 'public.professional_profiles'::regclass and conname = 'professional_profiles_verification_status_check'), 'verification status usa catalogo fechado');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.professional_connections'::regclass and conname = 'professional_connection_pair_unique'), 'par cliente/profissional e unico');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.professional_connections'::regclass and conname = 'professional_connection_distinct_people'), 'connection exige pessoas distintas');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.professional_connections'::regclass and conname = 'professional_connections_status_check'), 'connection status e fechado');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.sharing_permissions'::regclass and conname = 'sharing_permissions_scope_check'), 'scopes sao fechados');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.sharing_permissions'::regclass and conname = 'sharing_permission_scope_shape'), 'journal exige entry individual');
select has_index('public', 'sharing_permissions', 'sharing_permissions_target_unique', 'permission e unica por target');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.professional_notes'::regclass and conname = 'professional_notes_connection_fkey'), 'nota usa FK composta da connection');

select has_function('public', 'upsert_professional_profile', array['text', 'text'], 'RPC salva perfil sem auto-verificar');
select has_function('public', 'invite_professional', array['uuid'], 'RPC cria convite');
select has_function('public', 'respond_professional_invitation', array['uuid', 'boolean'], 'RPC aceita ou recusa convite');
select has_function('public', 'revoke_professional_connection', array['uuid'], 'RPC revoga connection');
select has_function('public', 'set_sharing_permission', array['uuid', 'text', 'boolean', 'uuid', 'timestamp with time zone'], 'RPC governa permission granular');
select has_function('public', 'professional_access_allowed', array['uuid', 'text', 'uuid'], 'helper fail-closed existe');
select ok(
  not has_function_privilege('anon', 'public.set_sharing_permission(uuid,text,boolean,uuid,timestamp with time zone)', 'EXECUTE'),
  'anon nao governa permission'
);
select ok(
  has_function_privilege('authenticated', 'public.upsert_professional_profile(text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.invite_professional(uuid)', 'EXECUTE') -- L-434: legado fechado
  and has_function_privilege('authenticated', 'public.respond_professional_invitation(uuid,boolean)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.revoke_professional_connection(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_sharing_permission(uuid,text,boolean,uuid,timestamp with time zone)', 'EXECUTE'),
  'authenticated usa apenas RPCs estreitas'
);

select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename in ('professional_profiles', 'professional_connections', 'sharing_permissions', 'professional_notes')),
  7,
  'entidades profissionais tem sete policies explicitas'
);
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_connected_professional'), 'perfil basico usa connection aceita');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'emotional_checkins' and policyname = 'emotional_checkins_select_professional'), 'emocional exige scope');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sleep_records' and policyname = 'sleep_records_select_professional'), 'sono exige scope separado');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'goals' and policyname = 'goals_select_professional'), 'metas exige scope separado');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'goal_progress_entries' and policyname = 'goal_progress_select_professional'), 'progresso herda scope de metas');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'journal_entries' and policyname = 'journal_entries_select_professional'), 'diario exige permission por entry');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cycle_profiles' and policyname = 'cycle_profiles_select_professional'), 'ciclo exige scope separado');
select ok(
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cycle_periods' and policyname = 'cycle_periods_select_professional')
  and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cycle_daily_records' and policyname = 'cycle_daily_records_select_professional'),
  'periodos e registros de ciclo usam o mesmo scope fechado'
);
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'report_snapshots' and policyname = 'report_snapshots_select_professional'), 'reports exige scope proprio');
select ok(not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_insights' and policyname like '%professional%'), 'insight PedroCore nao e compartilhado automaticamente');
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('emotional_checkins', 'sleep_records', 'goals', 'journal_entries', 'cycle_periods', 'cycle_daily_records', 'report_snapshots')
      and cmd in ('UPDATE', 'DELETE')
      and policyname like '%professional%'
  ),
  'profissional nunca recebe policy de mutacao em dado do usuario'
);
select has_trigger('public', 'professional_notes', 'professional_notes_audit_write', 'nota gera audit sanitizado');
select has_index('public', 'professional_connections', 'professional_connections_professional_status_idx', 'lista profissional tem indice');
select has_index('public', 'sharing_permissions', 'sharing_permissions_active_idx', 'permission vigente tem indice');

select * from finish();
rollback;
