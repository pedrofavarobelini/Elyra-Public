begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

-- Estrutura da lapide -------------------------------------------------------

select has_table('public', 'deletion_ledger', 'deletion_ledger existe');

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.deletion_ledger'::regclass),
  'lapide usa RLS forcada'
);

-- A propriedade central do `L-044`: a lapide **nao** pode referenciar
-- `auth.users`. Uma FK ali seria cascateada no instante exato em que o registro
-- precisa nascer, e a exclusao voltaria a ser invisivel para um restore.
select is_empty(
  $$select 1 from pg_constraint
    where conrelid = 'public.deletion_ledger'::regclass
      and contype = 'f'$$,
  'lapide nao tem foreign key - ela precisa sobreviver a exclusao que descreve'
);

select col_is_unique(
  'public', 'deletion_ledger', 'subject_user_id',
  'um sujeito tem no maximo uma lapide'
);

-- Minimizacao: a lapide guarda identificador, instante e origem. Se alguem
-- acrescentar e-mail, nome ou contagem de dados, este teste falha.
select set_eq(
  $$select column_name::text from information_schema.columns
    where table_schema = 'public' and table_name = 'deletion_ledger'$$,
  array['id', 'subject_user_id', 'deleted_at', 'origin', 'correlation_id'],
  'lapide guarda apenas o minimo para reconciliar um restore'
);

-- Fronteira -----------------------------------------------------------------

select ok(
  not has_table_privilege('anon', 'public.deletion_ledger', 'SELECT')
  and not has_table_privilege('authenticated', 'public.deletion_ledger', 'SELECT'),
  'lapide nao e visivel no plano de dados'
);

select ok(
  not has_table_privilege('anon', 'public.deletion_ledger', 'INSERT')
  and not has_table_privilege('authenticated', 'public.deletion_ledger', 'INSERT'),
  'ninguem forja lapide pelo plano de dados'
);

-- RLS forcada sem policy nenhuma e negacao total. Este teste garante que
-- ninguem "consertou" isso adicionando uma policy permissiva depois.
select is_empty(
  $$select 1 from pg_policies
    where schemaname = 'public' and tablename = 'deletion_ledger'$$,
  'lapide nao tem policy - RLS forcada sem policy e negacao total'
);

select ok(
  has_table_privilege('service_role', 'public.deletion_ledger', 'SELECT')
  and has_table_privilege('service_role', 'public.deletion_ledger', 'INSERT'),
  'reconciliacao operacional le e grava a lapide'
);

-- Imutabilidade -------------------------------------------------------------

select has_trigger(
  'public', 'deletion_ledger', 'deletion_ledger_immutable',
  'lapide e protegida por trigger contra reescrita'
);

insert into public.deletion_ledger (subject_user_id)
values ('00000000-0000-4000-8000-0000000000aa');

select throws_ok(
  $$update public.deletion_ledger
    set deleted_at = timezone('utc', now()) - interval '10 years'
    where subject_user_id = '00000000-0000-4000-8000-0000000000aa'$$,
  'ELYRA_DELETION_LEDGER_IS_IMMUTABLE',
  'reescrever o instante da exclusao e recusado'
);

select throws_ok(
  $$update public.deletion_ledger
    set subject_user_id = '00000000-0000-4000-8000-0000000000bb'
    where subject_user_id = '00000000-0000-4000-8000-0000000000aa'$$,
  'ELYRA_DELETION_LEDGER_IS_IMMUTABLE',
  'trocar o sujeito da lapide e recusado'
);

select throws_ok(
  $$insert into public.deletion_ledger (subject_user_id)
    values ('00000000-0000-4000-8000-0000000000aa')$$,
  '23505', null,
  'lapide duplicada e recusada pela unicidade'
);

select throws_ok(
  $$insert into public.deletion_ledger (subject_user_id, origin)
    values ('00000000-0000-4000-8000-0000000000cc', 'porque_sim')$$,
  '23514', null,
  'origem fora do vocabulario declarado e recusada'
);

-- Finalizacao da exclusao ---------------------------------------------------

select has_function(
  'public', 'finalize_account_deletion',
  'encerramento da conta continua sendo funcao unica'
);

-- A ordem e o contrato: a lapide nasce **antes** do `delete from auth.users`,
-- na mesma transacao. Se o delete falhar, o rollback leva a lapide junto e
-- nunca existe lapide de conta viva; se a lapide fosse gravada depois, haveria
-- uma janela em que a conta sumiu e nada registrou a exclusao.
select ok(
  (select position('deletion_ledger' in prosrc)
        < position('delete from auth.users' in prosrc)
   from pg_proc where proname = 'finalize_account_deletion'),
  'lapide e gravada antes de apagar a identidade, na mesma transacao'
);

-- `L-050` - ator inexistente vira nulo em vez de derrubar a exclusao -------
--
-- O gatilho existe por causa de uma falha real: `finalize_account_deletion`
-- termina com `delete from auth.users`, o cascade dispara os gatilhos de
-- auditoria de cada tabela de dominio, e eles gravam `auth.uid()` - uma
-- identidade que naquele instante ja esta sendo apagada. A FK recusava, e
-- **quem tinha uma anotacao no diario nao conseguia excluir a conta**.

select has_trigger(
  'public', 'audit_logs', 'audit_logs_anonymise_missing_actor',
  'escrita de auditoria passa pelo guarda de ator'
);

-- Ator que nao existe: a linha entra, com o ator anulado. A trilha permanece.
insert into public.audit_logs (actor_user_id, action, entity_type, outcome)
values ('00000000-0000-4000-8000-0000000000ff', 'account.deleted', 'account', 'success');

select is(
  (select actor_user_id from public.audit_logs
   where action = 'account.deleted' and entity_type = 'account'
   order by occurred_at desc limit 1),
  null,
  'ator inexistente e anonimizado em vez de quebrar a escrita'
);

select is(
  (select action from public.audit_logs
   where entity_type = 'account' order by occurred_at desc limit 1),
  'account.deleted',
  'a acao continua registrada - some o sujeito, nao a trilha'
);

-- Ator que existe continua sendo gravado: o guarda nao pode virar um apagador
-- silencioso de autoria legitima.
select is(
  (select count(*) from pg_proc where proname = 'anonymise_missing_audit_actor'
     and prosrc like '%not exists%'),
  1::bigint,
  'o guarda anula apenas quando a identidade realmente nao existe'
);

select * from finish();
rollback;
