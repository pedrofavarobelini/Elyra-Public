begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(34);

-- Estrutura ----------------------------------------------------------------

select has_table('public', 'account_deletions', 'account_deletions existe');
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.account_deletions'::regclass),
  'exclusao usa RLS forcada'
);
select ok(
  not has_table_privilege('anon', 'public.account_deletions', 'SELECT'),
  'anon nao le exclusao de conta'
);
-- Sem DELETE: o registro some junto com a conta, por cascade, e nunca por
-- alguem apagando a evidencia de que uma exclusao estava em andamento.
select ok(
  has_table_privilege('authenticated', 'public.account_deletions', 'SELECT')
  and has_table_privilege('authenticated', 'public.account_deletions', 'INSERT')
  and has_table_privilege('authenticated', 'public.account_deletions', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.account_deletions', 'DELETE'),
  'exclusao nao pode ser apagada pelo dono'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.account_deletions'::regclass
            and contype = 'u' and conname like '%user_id%'),
  'uma exclusao por pessoa'
);

-- Ordem e coerencia do lifecycle -------------------------------------------

select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.account_deletions'::regclass
            and conname = 'account_deletion_progress_order'),
  'learning antes de Storage, Storage antes do dominio'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.account_deletions'::regclass
            and conname = 'account_deletion_failure_shape'),
  'falha exige codigo proprio'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.account_deletions'::regclass
            and conname = 'account_deletions_status_check'),
  'status usa catalogo fechado'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.account_deletions'::regclass
            and conname = 'account_deletions_failure_code_check'),
  'codigo de falha usa catalogo fechado'
);
select has_trigger('public', 'account_deletions',
  'account_deletions_protect_contract', 'progresso e monotonico');
select ok(
  (select prosrc ilike '%ELYRA_DELETION_PROGRESS_IS_MONOTONIC%'
   from pg_proc where proname = 'protect_account_deletion_contract'),
  'retry avanca e nunca regride'
);
select ok(
  (select prosrc ilike '%ELYRA_DELETION_OWNER_IMMUTABLE%'
   from pg_proc where proname = 'protect_account_deletion_contract'),
  'dono da exclusao e imutavel'
);

-- Fronteira do dono ---------------------------------------------------------

select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public' and tablename = 'account_deletions'),
  3,
  'exclusao tem exatamente tres policies, todas do dono'
);
select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public' and tablename = 'account_deletions'
     and policyname like '%professional%'),
  0,
  'profissional nunca alcanca exclusao de conta'
);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'account_deletions'
      and qual ilike '%professional_access_allowed%'
  ),
  'exclusao nao consulta acesso profissional'
);

-- Finalizacao ---------------------------------------------------------------

select has_function('public', 'finalize_account_deletion', array[]::text[],
  'encerramento da conta tem funcao propria');
select ok(
  not has_function_privilege('anon', 'public.finalize_account_deletion()', 'EXECUTE'),
  'anon nao encerra conta'
);
select ok(
  has_function_privilege('authenticated', 'public.finalize_account_deletion()', 'EXECUTE'),
  'a propria pessoa encerra a propria conta'
);
select ok(
  (select prosecdef from pg_proc where proname = 'finalize_account_deletion'),
  'encerramento usa security definer, e nao service-role na aplicacao'
);
-- Verificacao, nao confianca: as etapas anteriores dizem que terminaram, e a
-- funcao confere antes de apagar.
select ok(
  (select prosrc ilike '%ELYRA_DELETION_LEARNING_PENDING%'
      and prosrc ilike '%ELYRA_DELETION_STORAGE_PENDING%'
   from pg_proc where proname = 'finalize_account_deletion'),
  'finalizacao recusa avancar com pendencia'
);
select ok(
  (select prosrc ilike '%from public.media_assets%'
      and prosrc ilike '%from public.learning_exports%'
   from pg_proc where proname = 'finalize_account_deletion'),
  'finalizacao confere o estado real antes de apagar'
);
select ok(
  (select prosrc ilike '%delete from auth.users%'
   from pg_proc where proname = 'finalize_account_deletion'),
  'encerramento remove a conta, e o dominio cascateia'
);
select ok(
  (select prosrc ilike '%auth.uid()%'
   from pg_proc where proname = 'finalize_account_deletion'),
  'encerramento age somente sobre quem chamou'
);

-- Trilha de auditoria -------------------------------------------------------

select is(
  (select confdeltype from pg_constraint
   where conrelid = 'public.audit_logs'::regclass
     and conname like '%actor_user_id%'),
  'n',
  'audit sobrevive ao titular com o ator anonimizado'
);
select has_trigger('public', 'account_deletions', 'account_deletions_audit_write',
  'progresso da exclusao gera audit');
select ok(
  (select prosrc ilike '%account.deleted%'
   from pg_proc where proname = 'finalize_account_deletion'),
  'exclusao concluida deixa rastro permanente'
);
select ok(
  (select prosrc not ilike '%new.failure_code%'
      and prosrc not ilike '%payload%'
   from pg_proc where proname = 'audit_stage14_deletion'),
  'audit registra o progresso, nunca o conteudo apagado'
);
select ok(
  not has_function_privilege('anon', 'public.audit_stage14_deletion()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.protect_account_deletion_contract()', 'EXECUTE'),
  'funcoes internas da Stage 14 nao sao expostas ao anon'
);

-- A exclusao nao guarda o que apagou -----------------------------------------

select is(
  (select count(*)::integer from information_schema.columns
   where table_schema = 'public' and table_name = 'account_deletions'
     and column_name in (
       'payload', 'content', 'journal', 'transcript', 'email', 'display_name'
     )),
  0,
  'registro de exclusao nao guarda conteudo do titular'
);
select is(
  (select count(*)::integer from information_schema.columns
   where table_schema = 'public' and table_name = 'account_deletions'
     and data_type in ('jsonb', 'json')),
  0,
  'registro de exclusao nao e deposito generico'
);

-- Cascade do dominio --------------------------------------------------------

-- Toda tabela do titular ancora em `auth.users` direta ou indiretamente; apagar
-- a conta cascateia o dominio inteiro sem DELETE manual tabela a tabela.
select is(
  (select confdeltype from pg_constraint
   where conrelid = 'public.account_deletions'::regclass
     and confrelid = 'auth.users'::regclass),
  'c',
  'registro de exclusao cascateia com a conta'
);
select is(
  (select confdeltype from pg_constraint
   where conrelid = 'public.profiles'::regclass
     and confrelid = 'auth.users'::regclass),
  'c',
  'perfil cascateia com a conta'
);
select is(
  (select confdeltype from pg_constraint
   where conrelid = 'public.consent_events'::regclass
     and confrelid = 'auth.users'::regclass),
  'c',
  'consentimentos cascateiam com a conta'
);
select is(
  (select confdeltype from pg_constraint
   where conrelid = 'public.learning_exports'::regclass
     and confrelid = 'auth.users'::regclass),
  'c',
  'governanca de learning cascateia com a conta'
);

select * from finish();
rollback;
