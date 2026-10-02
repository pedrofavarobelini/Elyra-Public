begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

select has_table('public', 'notifications', 'notifications existe');
select has_column('public', 'notifications', 'kind', 'categoria persistida');
select has_column('public', 'notifications', 'read_at', 'leitura persistida');
select has_column('public', 'notifications', 'event_key', 'dedupe persistido');

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.notifications'::regclass),
  'notifications usa RLS forcada'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.notifications'::regclass
      and conname = 'notifications_user_event_unique'
      and contype = 'u'
  ),
  'event_key e unico por pessoa'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.notifications'::regclass
      and conname = 'notifications_kind_check'
      and contype = 'c'
  ),
  'categoria tem vocabulary fechado'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.notifications'::regclass
      and conname = 'notifications_event_kind_match'
      and contype = 'c'
  ),
  'event_key precisa corresponder a categoria'
);

select is(
  (select confdeltype
   from pg_constraint
   where conrelid = 'public.notifications'::regclass
     and conname = 'notifications_user_id_fkey'),
  'c'::"char",
  'notificacoes cascateiam com o titular'
);

select has_index(
  'public', 'notifications', 'notifications_user_time_idx',
  'listagem por pessoa e tempo esta indexada'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'notifications'
      and indexname = 'notifications_user_unread_idx'
      and indexdef ilike '%where (read_at is null)%'
  ),
  'nao lidas usam indice parcial'
);

select ok(
  has_table_privilege('authenticated', 'public.notifications', 'SELECT'),
  'authenticated pode ler sob RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.notifications', 'INSERT'),
  'authenticated nao fabrica notificacao'
);
select ok(
  not has_table_privilege('authenticated', 'public.notifications', 'UPDATE'),
  'authenticated nao altera linha diretamente'
);
select ok(
  not has_table_privilege('authenticated', 'public.notifications', 'DELETE'),
  'authenticated nao apaga linha diretamente'
);
select ok(
  not has_table_privilege('anon', 'public.notifications', 'SELECT'),
  'anonimo nao le notificacoes'
);
select ok(
  has_table_privilege('service_role', 'public.notifications', 'SELECT')
  and has_table_privilege('service_role', 'public.notifications', 'INSERT')
  and has_table_privilege('service_role', 'public.notifications', 'UPDATE')
  and has_table_privilege('service_role', 'public.notifications', 'DELETE'),
  'service_role mantem controle operacional'
);

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'notifications'),
  1,
  'existe somente a policy de leitura propria'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'notifications'
      and cmd = 'SELECT'
      and qual ilike '%auth.uid()%'
  ),
  'policy de leitura ancora em auth.uid'
);

select has_function(
  'public', 'materialize_in_app_notifications', array[]::text[],
  'RPC de materializacao existe sem user_id de entrada'
);
select ok(
  (select prosecdef from pg_proc
   where oid = 'public.materialize_in_app_notifications()'::regprocedure),
  'materializacao e security definer'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.materialize_in_app_notifications()', 'EXECUTE'
  ),
  'authenticated executa materializacao fechada'
);
select ok(
  not has_function_privilege(
    'anon', 'public.materialize_in_app_notifications()', 'EXECUTE'
  ),
  'anonimo nao materializa'
);
select ok(
  (select prosrc ilike '%auth.uid()%'
   from pg_proc
   where oid = 'public.materialize_in_app_notifications()'::regprocedure),
  'materializacao usa a identidade da sessao'
);

select has_function(
  'public', 'mark_in_app_notification_read', array['uuid']::text[],
  'RPC de leitura existe'
);
select ok(
  (select prosecdef from pg_proc
   where oid = 'public.mark_in_app_notification_read(uuid)'::regprocedure),
  'leitura e security definer'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.mark_in_app_notification_read(uuid)', 'EXECUTE'
  ),
  'authenticated marca somente pela RPC'
);
select ok(
  not has_function_privilege(
    'anon', 'public.mark_in_app_notification_read(uuid)', 'EXECUTE'
  ),
  'anonimo nao marca leitura'
);
select ok(
  (select prosrc ilike '%auth.uid()%'
   from pg_proc
   where oid = 'public.mark_in_app_notification_read(uuid)'::regprocedure),
  'leitura usa a identidade da sessao'
);

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public'
     and tablename = 'notifications'
     and coalesce(qual, '') = 'true'),
  0,
  'nenhuma policy permissiva universal'
);

select * from finish();

rollback;
