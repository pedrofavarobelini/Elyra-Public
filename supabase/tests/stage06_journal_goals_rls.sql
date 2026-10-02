begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(37);

select has_table('public', 'journal_tags', 'journal_tags existe');
select has_table('public', 'journal_entries', 'journal_entries existe');
select has_table('public', 'journal_entry_tags', 'join do diario existe');
select has_table('public', 'goals', 'goals existe');
select has_table('public', 'goal_progress_entries', 'eventos de progresso existem');

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.journal_tags'::regclass), 'tags usam RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.journal_entries'::regclass), 'diario usa RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.journal_entry_tags'::regclass), 'join do diario usa RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.goals'::regclass), 'metas usam RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.goal_progress_entries'::regclass), 'progresso usa RLS forcada');

select has_trigger('public', 'journal_entries', 'journal_entries_set_updated_at', 'diario atualiza timestamp');
select has_trigger('public', 'goals', 'goals_set_updated_at', 'meta atualiza timestamp');
select has_trigger('public', 'goal_progress_entries', 'goal_progress_requires_active_goal', 'progresso exige meta ativa');
select has_trigger('public', 'journal_entries', 'journal_entries_audit_write', 'diario gera audit sanitizado');
select has_trigger('public', 'journal_tags', 'journal_tags_audit_insert', 'tag custom gera audit');
select has_trigger('public', 'goals', 'goals_audit_write', 'meta gera audit');
select has_trigger('public', 'goal_progress_entries', 'goal_progress_audit_write', 'progresso gera audit');

select is((select count(*)::integer from public.journal_tags where origin = 'system'), 4, 'catalogo system tem quatro tags');
select ok(
  (select cardinality(indkey) = 2 from pg_index where indrelid = 'public.journal_entry_tags'::regclass and indisprimary),
  'join do diario usa PK composta'
);
select ok(exists (select 1 from pg_constraint where conrelid = 'public.journal_entries'::regclass and conname = 'journal_entry_has_content'), 'diario exige titulo ou conteudo');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.journal_tags'::regclass and conname = 'journal_tag_owner_shape'), 'tag trava shape system/custom');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.goals'::regclass and conname = 'goals_status_check'), 'meta restringe status');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.goals'::regclass and conname = 'goals_recurrence_check'), 'meta restringe recorrencia');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.goals'::regclass and conname = 'goals_target_check'), 'meta exige alvo positivo');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.goal_progress_entries'::regclass and conname = 'goal_progress_entries_amount_check'), 'evento exige quantidade positiva');

select has_function('public', 'save_journal_entry', array['jsonb'], 'RPC atomica do diario existe');
select has_function('public', 'purge_expired_journal_entries', array[]::text[], 'RPC de expurgo existe');
select has_function('public', 'create_emotional_checkin_v2', array['jsonb'], 'RPC emocional usa relogio do banco');
select ok(
  not has_table_privilege('anon', 'public.journal_tags', 'SELECT')
  and not has_table_privilege('anon', 'public.journal_entries', 'SELECT')
  and not has_table_privilege('anon', 'public.journal_entry_tags', 'SELECT')
  and not has_table_privilege('anon', 'public.goals', 'SELECT')
  and not has_table_privilege('anon', 'public.goal_progress_entries', 'SELECT'),
  'anon nao recebe leitura da Stage 06'
);
select ok(has_table_privilege('authenticated', 'public.journal_entries', 'UPDATE'), 'owner pode editar diario');
select ok(has_table_privilege('authenticated', 'public.journal_entries', 'DELETE'), 'owner pode excluir diario explicitamente');
select ok(not has_table_privilege('authenticated', 'public.goal_progress_entries', 'UPDATE'), 'evento de progresso e imutavel');
select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename in ('journal_tags', 'journal_entries', 'journal_entry_tags', 'goals', 'goal_progress_entries') and policyname not like '%professional%'),
  16,
  'dezesseis policies explicitas protegem a Stage 06'
);
select has_index('public', 'journal_entries', 'journal_entries_user_active_idx', 'diario ativo usa indice owner/tempo');
select has_index('public', 'journal_entries', 'journal_entries_user_trash_idx', 'lixeira usa indice owner/tempo');
select has_index('public', 'goals', 'goals_user_status_idx', 'metas usam indice owner/status');
select has_index('public', 'goal_progress_entries', 'goal_progress_goal_day_idx', 'progresso usa indice meta/data');

select * from finish();
rollback;
