-- ---------------------------------------------------------------------------
-- Stage 16 - fundacao operacional: lapide de exclusao (`L-044`).
--
-- O problema, exatamente como ele acontece:
--
--   T0  a pessoa cria conta e dados
--   T1  backup do ambiente
--   T2  mais dados
--   T3  a pessoa exclui a conta
--   T4  o ambiente e perdido e restaurado a partir do backup de T1
--
-- Em T4 tudo volta - inclusive o que a pessoa mandou apagar em T3. E nao ha
-- como saber que ela pediu exclusao, porque **nada sobrevive para dizer isso**.
-- `account_deletions.user_id` referencia `auth.users(id) on delete cascade`,
-- entao a propria linha de governanca da exclusao desaparece quando a exclusao
-- se completa. O `audit_logs` sobrevive, mas com `actor_user_id` anulado por
-- `on delete set null`: o evento fica, o sujeito nao.
--
-- Uma exclusao que o backup pode desfazer nao e uma exclusao. E por isso que
-- esta tabela existe.
--
-- ---------------------------------------------------------------------------
-- Por que ela NAO referencia `auth.users`
--
-- Qualquer FK para `auth.users` seria cascateada ou anulada no momento exato em
-- que este registro precisa nascer. A ausencia de FK aqui nao e descuido: e o
-- unico jeito de o registro sobreviver ao proprio evento que ele descreve.
--
-- ---------------------------------------------------------------------------
-- Minimizacao
--
-- A lapide guarda tres coisas: **qual** identificador foi excluido, **quando**,
-- e **por qual caminho**. Nada mais. Sem nome, sem e-mail, sem conteudo, sem
-- contagem do que existia. O `subject_user_id` e um UUID pseudonimo que, por
-- construcao, ja nao resolve para nada no sistema ativo - depois da exclusao
-- ele nao e chave de nada. Guardar menos que isso tornaria a reconciliacao
-- impossivel, e uma reconciliacao impossivel devolve o problema original.
--
-- Um hash no lugar do UUID foi considerado e recusado: o conjunto de candidatos
-- num restore e justamente o conjunto de usuarios restaurados, entao o hash
-- seria invertido em uma passagem. Ceremonia sem protecao real.
-- ---------------------------------------------------------------------------

create table public.deletion_ledger (
  id uuid primary key default gen_random_uuid(),
  -- Deliberadamente **sem** foreign key. Ver o bloco acima.
  subject_user_id uuid not null unique,
  deleted_at timestamptz not null default timezone('utc', now()),
  origin text not null default 'account_deletion'
    check (origin in ('account_deletion')),
  -- Correlaciona com `audit_logs` sem duplicar nada de la.
  correlation_id uuid not null default gen_random_uuid()
);

-- A reconciliacao pergunta sempre a mesma coisa: "o que foi excluido depois do
-- instante deste backup?". O indice existe para essa pergunta.
create index deletion_ledger_deleted_at_idx
on public.deletion_ledger (deleted_at);

comment on table public.deletion_ledger is
  'Lapides de exclusao que sobrevivem ao restore. Sem FK para auth.users por design.';

-- ---------------------------------------------------------------------------
-- RLS: ninguem no plano de dados le isto.
--
-- A lapide e artefato operacional, nao dado de produto. Nenhum papel da
-- aplicacao precisa dela, e um titular nao ganha nada em consulta-la - a conta
-- dele ja nao existe. `service_role` a le durante a reconciliacao de restore, e
-- so.
-- ---------------------------------------------------------------------------

alter table public.deletion_ledger enable row level security;
alter table public.deletion_ledger force row level security;

revoke all on table public.deletion_ledger from anon, authenticated;
grant select, insert, delete on table public.deletion_ledger to service_role;

-- Sem policy nenhuma para `anon` e `authenticated`: RLS forcada sem policy e
-- negacao total, que e o comportamento desejado (fail-closed).

-- ---------------------------------------------------------------------------
-- A lapide e imutavel.
--
-- Reescrever qual identificador foi excluido, ou quando, apagaria a unica prova
-- que sobrevive ao restore.
-- ---------------------------------------------------------------------------

create or replace function public.protect_deletion_ledger()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'ELYRA_DELETION_LEDGER_IS_IMMUTABLE';
end;
$$;

create trigger deletion_ledger_immutable
before update on public.deletion_ledger
for each row execute function public.protect_deletion_ledger();

revoke all on function public.protect_deletion_ledger() from public;

-- ---------------------------------------------------------------------------
-- `finalize_account_deletion` passa a gravar a lapide.
--
-- Reescrita integral da funcao da Stage 14, com **uma** mudanca: o `insert` na
-- lapide, imediatamente antes do `delete from auth.users`. Tudo o mais e
-- identico, incluindo as verificacoes que recusam finalizar enquanto Storage ou
-- learning ainda tiverem pendencia.
--
-- A ordem importa. A lapide nasce **antes** do `delete`, dentro da mesma
-- transacao: se o `delete` falhar, a lapide desaparece junto com o rollback, e
-- nunca existe lapide de uma conta que continua viva. O inverso - apagar
-- primeiro e registrar depois - deixaria uma janela em que a exclusao aconteceu
-- e nada a registrou, que e exatamente o buraco que o `L-044` descreve.
-- ---------------------------------------------------------------------------

create or replace function public.finalize_account_deletion()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  deletion public.account_deletions%rowtype;
  remaining_assets integer;
  remaining_exports integer;
  ledger_correlation uuid := gen_random_uuid();
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  select * into deletion
  from public.account_deletions
  where user_id = current_user_id;

  if not found then
    raise exception 'ELYRA_DELETION_NOT_REQUESTED';
  end if;

  if deletion.learning_revoked_at is null then
    raise exception 'ELYRA_DELETION_LEARNING_PENDING';
  end if;
  if deletion.storage_cleared_at is null then
    raise exception 'ELYRA_DELETION_STORAGE_PENDING';
  end if;

  -- Verificacao, nao confianca: as etapas anteriores dizem que terminaram, e
  -- aqui se confere que terminaram mesmo.
  select count(*) into remaining_assets
  from public.media_assets
  where user_id = current_user_id and deleted_at is null;
  if remaining_assets > 0 then
    raise exception 'ELYRA_DELETION_STORAGE_PENDING';
  end if;

  select count(*) into remaining_exports
  from public.learning_exports
  where user_id = current_user_id
    and status in ('eligible', 'exported');
  if remaining_exports > 0 then
    raise exception 'ELYRA_DELETION_LEARNING_PENDING';
  end if;

  -- Rastro permanente da exclusao. `audit_logs.actor_user_id` e
  -- `on delete set null`, entao o evento sobrevive com o ator anonimizado —
  -- que e exatamente o comportamento desejado.
  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    current_user_id, 'account.deleted', 'account', deletion.id,
    'success', ledger_correlation
  );

  -- A lapide que sobrevive ao restore (`L-044`). `on conflict do nothing`
  -- porque a exclusao e idempotente por contrato: um retry nao pode falhar por
  -- causa do registro que o retry anterior ja deixou.
  insert into public.deletion_ledger (
    subject_user_id, origin, correlation_id
  ) values (
    current_user_id, 'account_deletion', ledger_correlation
  )
  on conflict (subject_user_id) do nothing;

  -- Apagar de `auth.users` cascateia todo o dominio, porque cada tabela
  -- ancora em `auth.users(id)` diretamente ou via `profiles(user_id)`.
  delete from auth.users where id = current_user_id;

  return deletion.id;
end;
$$;

revoke all on function public.finalize_account_deletion() from public, anon;
grant execute on function public.finalize_account_deletion() to authenticated;

-- ---------------------------------------------------------------------------
-- `L-050` - exclusao de conta falhava para quem tinha diario, metas ou ciclo.
--
-- Descoberto na Stage 16, ao provar o `L-044` com uma conta que tinha dados de
-- verdade. `finalize_account_deletion` termina com `delete from auth.users`, o
-- que cascateia o dominio inteiro. Cada tabela de dominio tem um gatilho de
-- auditoria `after ... or delete` que grava `auth.uid()` em
-- `audit_logs.actor_user_id`. Durante o cascade, essa identidade **ja esta
-- sendo apagada**, e a FK recusa:
--
--   insert or update on table "audit_logs" violates foreign key constraint
--   "audit_logs_actor_user_id_fkey"
--
-- Resultado: uma pessoa com uma unica anotacao no diario nao conseguia excluir
-- a propria conta. O direito existia no papel e falhava na execucao.
--
-- Por que ninguem viu antes: em `psql` sem JWT, `auth.uid()` e nulo, entao o
-- gatilho grava ator nulo e o cascade passa. A falha so aparece pelo caminho
-- real - RPC autenticado, `security definer` - e o harness da Stage 14 excluiu
-- contas que nao tinham diario, metas nem ciclo. O teste existia; o dado dele
-- e que era leve demais.
--
-- ## A correcao, e por que num ponto so
--
-- Havia duas opcoes: reescrever as quatorze funcoes de auditoria, ou tratar a
-- questao onde ela realmente vive - na escrita de `audit_logs`. A segunda e
-- melhor por tres motivos: e uma regra em vez de quatorze copias; alcanca
-- qualquer auditoria futura sem que ninguem precise lembrar; e diz exatamente o
-- que a Stage 14 ja tinha decidido em texto - *"o ator vira null e a trilha
-- permanece"*. Aqui essa frase deixa de ser intencao e vira mecanismo.
--
-- A trilha nao se perde: a acao, a entidade, o desfecho e a correlacao
-- continuam gravados. O que se perde e a identificacao de alguem que pediu para
-- deixar de existir no sistema - que e precisamente o resultado desejado.
-- ---------------------------------------------------------------------------

create or replace function public.anonymise_missing_audit_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.actor_user_id is not null
    and not exists (select 1 from auth.users where id = new.actor_user_id) then
    new.actor_user_id := null;
  end if;
  return new;
end;
$$;

create trigger audit_logs_anonymise_missing_actor
before insert on public.audit_logs
for each row execute function public.anonymise_missing_audit_actor();

revoke all on function public.anonymise_missing_audit_actor() from public;
