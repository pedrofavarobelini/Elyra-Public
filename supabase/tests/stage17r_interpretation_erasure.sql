begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

-- ---------------------------------------------------------------------------
-- Stage 17-R: o direito ao apagamento vence a imutabilidade da interpretacao.
--
-- O trigger da Stage 12 recusava `update OR delete` incondicionalmente. Isso
-- tornava a exclusao de conta IMPOSSIVEL assim que existisse uma interpretacao
-- real, porque `finalize_account_deletion` termina em `delete from auth.users`
-- e a cascata chega ate aqui. O defeito nasceu na Stage 12 e so ficou
-- alcancavel quando a Stage 17-R criou o writer.
--
-- A imutabilidade para o dono nao foi enfraquecida: ela migrou de "trigger" para
-- as duas camadas que ja existiam e que a cascata nao aciona — privilegio e RLS.
-- Estes testes provam as duas metades ao mesmo tempo.
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int
   from pg_trigger
   where tgrelid = 'public.session_interpretations'::regclass
     and tgname = 'session_interpretations_reject_update'
     and not tgisinternal),
  1,
  'o guard de mutacao continua existindo'
);

-- `tgtype` e um bitmask: 4 = INSERT, 8 = DELETE, 16 = UPDATE.
select is(
  (select (tgtype & 16) > 0
   from pg_trigger
   where tgrelid = 'public.session_interpretations'::regclass
     and tgname = 'session_interpretations_reject_update'),
  true,
  'o guard recusa UPDATE'
);

select is(
  (select (tgtype & 8) > 0
   from pg_trigger
   where tgrelid = 'public.session_interpretations'::regclass
     and tgname = 'session_interpretations_reject_update'),
  false,
  'o guard NAO intercepta DELETE, para nao bloquear a cascata de apagamento'
);

-- Camada 1: privilegio. O dono nunca recebeu delete nem update.
select ok(
  not has_table_privilege('authenticated', 'public.session_interpretations', 'DELETE'),
  'authenticated nao tem privilegio de DELETE'
);

select ok(
  not has_table_privilege('authenticated', 'public.session_interpretations', 'UPDATE'),
  'authenticated nao tem privilegio de UPDATE'
);

-- Camada 2: RLS. Sem policy de delete, o default deny vale mesmo com privilegio.
select is(
  (select count(*)::int
   from pg_policies
   where schemaname = 'public'
     and tablename = 'session_interpretations'
     and cmd in ('DELETE', 'UPDATE')),
  0,
  'nao existe policy de DELETE nem de UPDATE em session_interpretations'
);

select ok(
  (select relforcerowsecurity
   from pg_class where oid = 'public.session_interpretations'::regclass),
  'force row level security continua ativo'
);

-- A cascata precisa existir para o apagamento chegar ate aqui.
select is(
  (select confdeltype
   from pg_constraint
   where conrelid = 'public.session_interpretations'::regclass
     and conname = 'session_interpretations_session_id_fkey'),
  'c'::"char",
  'session_id cascateia na exclusao da sessao'
);

select is(
  (select confdeltype
   from pg_constraint
   where conrelid = 'public.session_interpretations'::regclass
     and conname = 'session_interpretations_user_id_fkey'),
  'c'::"char",
  'user_id cascateia na exclusao do titular'
);

select * from finish();

rollback;
