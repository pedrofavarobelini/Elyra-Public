-- Stage 14: direitos do titular — exportacao e exclusao — e hardening.
--
-- A exportacao NAO ganha RPC: ela e montada na camada de servico usando o
-- proprio client RLS da pessoa autenticada. Assim o isolamento nao depende de
-- uma funcao nova estar correta — depende das policies que ja foram provadas
-- Stage a Stage. Uma `security definer` que "exporta os dados do usuario" seria
-- justamente o lugar onde um bug viraria vazamento cross-user.
--
-- A exclusao ganha estado explicito. `on delete cascade` sozinho apagaria as
-- linhas, mas nao apaga objeto de Storage, nao revoga candidato de learning no
-- PedroCore e nao deixa rastro de que a exclusao aconteceu. Exclusao parcial
-- silenciosa e exatamente o que a Stage proibe.

-- ---------------------------------------------------------------------------
-- account_deletions — lifecycle explicito da exclusao.
-- ---------------------------------------------------------------------------

create table public.account_deletions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  status text not null default 'requested' check (status in (
    'requested',
    'learning_revoked',
    'storage_cleared',
    'domain_cleared',
    'failed'
  )),
  -- Cada etapa registra quando terminou. Uma etapa sem carimbo nao aconteceu.
  requested_at timestamptz not null default timezone('utc', now()),
  learning_revoked_at timestamptz,
  storage_cleared_at timestamptz,
  domain_cleared_at timestamptz,
  -- Contagem verificada no fim de cada etapa: "deveria ter apagado" nao e prova.
  storage_objects_removed integer not null default 0
    check (storage_objects_removed >= 0),
  learning_exports_revoked integer not null default 0
    check (learning_exports_revoked >= 0),
  attempts smallint not null default 1 check (attempts between 1 and 50),
  failure_code text check (
    failure_code is null or failure_code in (
      'learning_revocation_failed',
      'storage_cleanup_failed',
      'domain_cleanup_failed',
      'verification_failed'
    )
  ),
  updated_at timestamptz not null default timezone('utc', now()),

  -- Ordem obrigatoria: learning antes de Storage, Storage antes do dominio.
  -- Apagar a midia antes de revogar o candidato deixaria o PedroCore com um
  -- candidato elegivel cuja origem ja nao existe.
  constraint account_deletion_progress_order check (
    (learning_revoked_at is null and storage_cleared_at is null
      and domain_cleared_at is null)
    or (learning_revoked_at is not null and storage_cleared_at is null
      and domain_cleared_at is null)
    or (learning_revoked_at is not null and storage_cleared_at is not null
      and domain_cleared_at is null)
    or (learning_revoked_at is not null and storage_cleared_at is not null
      and domain_cleared_at is not null)
  ),
  constraint account_deletion_failure_shape check (
    (status = 'failed' and failure_code is not null)
    or (status <> 'failed' and failure_code is null)
  )
);

create index account_deletions_status_idx
on public.account_deletions (status, requested_at);

create trigger account_deletions_set_updated_at
before update on public.account_deletions
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: owner-only, sem fronteira profissional.
-- ---------------------------------------------------------------------------

alter table public.account_deletions enable row level security;
alter table public.account_deletions force row level security;

revoke all on table public.account_deletions from anon, authenticated;
grant select, insert, update on table public.account_deletions to authenticated;
grant all on table public.account_deletions to service_role;

create policy account_deletions_select_own
on public.account_deletions for select to authenticated
using ((select auth.uid()) = user_id);

create policy account_deletions_insert_own
on public.account_deletions for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy account_deletions_update_own
on public.account_deletions for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Nenhuma policy profissional: um profissional nunca inicia, ve ou interfere na
-- exclusao da conta de um paciente.

create or replace function public.protect_account_deletion_contract()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.user_id <> old.user_id then
    raise exception 'ELYRA_DELETION_OWNER_IMMUTABLE';
  end if;
  -- Carimbo de etapa concluida nao volta atras: retry avanca, nunca regride.
  if (old.learning_revoked_at is not null and new.learning_revoked_at is null)
    or (old.storage_cleared_at is not null and new.storage_cleared_at is null)
    or (old.domain_cleared_at is not null and new.domain_cleared_at is null) then
    raise exception 'ELYRA_DELETION_PROGRESS_IS_MONOTONIC';
  end if;
  return new;
end;
$$;

create trigger account_deletions_protect_contract
before update on public.account_deletions
for each row execute function public.protect_account_deletion_contract();

revoke all on function public.protect_account_deletion_contract() from public;

-- ---------------------------------------------------------------------------
-- Encerramento da conta.
--
-- `security definer` porque `auth.users` nao e alcancavel pelo papel
-- `authenticated`. A alternativa seria dar service-role a aplicacao, e a
-- aplicacao **nunca** usou service-role — propriedade que esta Stage preserva.
--
-- A funcao nao decide nada: ela exige que as etapas anteriores ja tenham
-- carimbo. Se o Storage nao foi limpo, ela recusa em vez de apagar a linha e
-- deixar o objeto orfao para sempre.
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
    'success', gen_random_uuid()
  );

  -- Apagar de `auth.users` cascateia todo o dominio, porque cada tabela
  -- ancora em `auth.users(id)` diretamente ou via `profiles(user_id)`.
  delete from auth.users where id = current_user_id;

  return deletion.id;
end;
$$;

revoke all on function public.finalize_account_deletion() from public, anon;
grant execute on function public.finalize_account_deletion() to authenticated;

-- ---------------------------------------------------------------------------
-- Audit da exclusao.
-- ---------------------------------------------------------------------------

create or replace function public.audit_stage14_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Registra o progresso, nunca o conteudo do que foi apagado.
  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    auth.uid(),
    'account_deletion.' || new.status,
    'account_deletion',
    new.id,
    case when new.status = 'failed' then 'failure' else 'success' end,
    gen_random_uuid()
  );
  return new;
end;
$$;

create trigger account_deletions_audit_write
after insert or update on public.account_deletions
for each row execute function public.audit_stage14_deletion();

revoke all on function public.audit_stage14_deletion() from public;
