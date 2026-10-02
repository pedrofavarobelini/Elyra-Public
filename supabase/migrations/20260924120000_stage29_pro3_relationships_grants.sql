-- Stage 29 / PRO-3 - relationship + grants: o portao de seguranca critico.
--
-- **Evoluir, nao duplicar (D-29-01, D-29-02).** `professional_connections` e a
-- relationship; `sharing_permissions` e o grant. Nenhuma tabela paralela: as
-- FKs das notas, do access log e dos convites continuam apontando para as
-- mesmas linhas, e o export do titular continua lendo as mesmas tabelas.
--
-- **Relationship.** `pending | active | paused | revoked | ended`.
--   - `accepted` (Stage 10) migra para `active`, sem mudar significado;
--   - `paused`: so o titular pausa e retoma; grants preservados, leitura negada;
--   - `revoked`: encerrado pelo titular; `ended`: encerrado pelo profissional.
--     Os dois revogam todos os grants.
--
-- **Grant.** Mapeamento de contrato, sem renomear coluna:
--   resource_type = scope · resource_id = journal_entry_id ·
--   valid_until = expires_at · + valid_from · + permission ('read').
--
-- **A regra de leitura, inteira, num lugar so.** Acesso profissional existe
-- somente quando TODAS valem:
--   relationship `active` + verificacao vigente + grant `granted` +
--   `permission = read` + `valid_from <= agora < valid_until` + escopo +
--   recurso (diario por entrada) + janela de dados + consentimento especifico
--   da sessao multimodal (nas policies do multimodal, inalteradas).
-- Os dois helpers abaixo sao o funil de todas as 25 policies de leitura.
--
-- **Trilha do titular (D-29-05).** `professional_access_log` passa a registrar
-- tambem o ciclo de vida (vinculo e grant), para que a pessoa veja inclusive o
-- que o profissional fez. Sem conteudo: evento, ator, relationship, categoria,
-- resultado, instante, correlation id e versao de policy.
--
-- Migration **aditiva**. A unica mudanca de valor e `accepted -> active`,
-- reversivel e sem perda (o significado e o mesmo; `accepted_at` preservado).

-- ---------------------------------------------------------------------------
-- 1. Relationship
-- ---------------------------------------------------------------------------

alter table public.professional_connections
  add column if not exists paused_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists ended_by_user_id uuid
    references public.profiles(user_id) on delete set null;

alter table public.professional_connections
  drop constraint if exists professional_connection_status_shape;
alter table public.professional_connections
  drop constraint if exists professional_connections_status_check;

update public.professional_connections set status = 'active' where status = 'accepted';

alter table public.professional_connections
  alter column status set default 'pending';

-- Nome historico preservado: o pgTAP da Stage 10 afirma catalogo fechado.
alter table public.professional_connections
  add constraint professional_connections_status_check
  check (status in ('pending', 'active', 'paused', 'revoked', 'ended'));

alter table public.professional_connections
  add constraint professional_connection_status_shape check (
    (status = 'pending' and accepted_at is null and revoked_at is null
      and ended_at is null and paused_at is null)
    or (status = 'active' and accepted_at is not null and revoked_at is null
      and ended_at is null and paused_at is null)
    or (status = 'paused' and accepted_at is not null and paused_at is not null
      and revoked_at is null and ended_at is null)
    or (status = 'revoked' and revoked_at is not null and ended_at is null)
    or (status = 'ended' and ended_at is not null and revoked_at is null)
  );

comment on column public.professional_connections.status is
  'Relationship: pending | active | paused | revoked (pelo titular) | ended (pelo profissional).';

-- ---------------------------------------------------------------------------
-- 2. Grant
-- ---------------------------------------------------------------------------

alter table public.sharing_permissions
  add column if not exists valid_from timestamptz,
  add column if not exists permission text not null default 'read';

alter table public.sharing_permissions
  add constraint sharing_permissions_permission_check check (permission in ('read')),
  add constraint sharing_permission_validity_order check (
    valid_from is null or expires_at is null or expires_at > valid_from
  );

comment on column public.sharing_permissions.valid_from is
  'Inicio da vigencia do grant. NULL = vigente desde a concessao.';
comment on column public.sharing_permissions.permission is
  'Nivel de acesso. Somente leitura existe: o profissional nunca escreve dado pessoal.';
comment on column public.sharing_permissions.expires_at is
  'valid_until do grant: a partir deste instante o profissional deixa de ler.';

-- ---------------------------------------------------------------------------
-- 3. Trilha do titular
-- ---------------------------------------------------------------------------

alter table public.professional_access_log
  add column if not exists event_type text not null default 'resource_viewed',
  add column if not exists actor_role text not null default 'professional',
  add column if not exists outcome text not null default 'success',
  add column if not exists correlation_id uuid not null default gen_random_uuid(),
  add column if not exists policy_version text not null default 'stage29.pro3.v1';

alter table public.professional_access_log alter column scope drop not null;

alter table public.professional_access_log
  add constraint professional_access_log_event_type_check check (event_type in (
    'resource_viewed',
    'relationship_created',
    'relationship_paused',
    'relationship_resumed',
    'relationship_revoked',
    'relationship_ended',
    'grant_created',
    'grant_changed',
    'grant_revoked'
  )),
  add constraint professional_access_log_actor_role_check
    check (actor_role in ('professional', 'client')),
  add constraint professional_access_log_outcome_check
    check (outcome in ('success', 'denied')),
  add constraint professional_access_log_scope_shape check (
    (event_type in ('resource_viewed', 'grant_created', 'grant_changed', 'grant_revoked')
      and scope is not null)
    or (event_type like 'relationship_%' and scope is null)
  );

comment on table public.professional_access_log is
  'Trilha profissional do titular: leituras e ciclo de vida de vinculo e grant. Sem conteudo.';

create index if not exists professional_access_log_connection_idx
  on public.professional_access_log (connection_id, occurred_at desc);

-- Gravacao de ciclo de vida, so por funcao `security definer`.
create or replace function public.professional_trail_append(
  p_connection_id uuid,
  p_event_type text,
  p_scope text,
  p_actor_role text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.professional_access_log (
    connection_id, client_user_id, professional_user_id, scope, event_type, actor_role
  )
  select connection.id, connection.client_user_id, connection.professional_user_id,
         p_scope, p_event_type, p_actor_role
  from public.professional_connections connection
  where connection.id = p_connection_id;
$$;

revoke all on function public.professional_trail_append(uuid, text, text, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Helpers de leitura (mesma assinatura; corpo completo)
-- ---------------------------------------------------------------------------

create or replace function public.professional_access_allowed(
  p_client_user_id uuid,
  p_scope text,
  p_journal_entry_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.professional_verification_is_current(auth.uid())
    and exists (
      select 1
      from public.professional_connections connection
      join public.sharing_permissions permission
        on permission.connection_id = connection.id
      where connection.client_user_id = p_client_user_id
        and connection.professional_user_id = auth.uid()
        and connection.status = 'active'
        and permission.scope = p_scope
        and permission.permission = 'read'
        and permission.status = 'granted'
        and permission.revoked_at is null
        and (permission.valid_from is null or permission.valid_from <= statement_timestamp())
        and (permission.expires_at is null or permission.expires_at > statement_timestamp())
        and (
          (p_scope = 'journal_entry' and permission.journal_entry_id = p_journal_entry_id)
          or (p_scope <> 'journal_entry' and permission.journal_entry_id is null)
        )
    ), false);
$$;

create or replace function public.professional_access_allowed_on(
  p_client_user_id uuid,
  p_scope text,
  p_from date,
  p_to date,
  p_journal_entry_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.professional_verification_is_current(auth.uid())
    and exists (
      select 1
      from public.professional_connections connection
      join public.sharing_permissions permission
        on permission.connection_id = connection.id
      where connection.client_user_id = p_client_user_id
        and connection.professional_user_id = auth.uid()
        and connection.status = 'active'
        and permission.scope = p_scope
        and permission.permission = 'read'
        and permission.status = 'granted'
        and permission.revoked_at is null
        and (permission.valid_from is null or permission.valid_from <= statement_timestamp())
        and (permission.expires_at is null or permission.expires_at > statement_timestamp())
        and (
          (p_scope = 'journal_entry' and permission.journal_entry_id = p_journal_entry_id)
          or (p_scope <> 'journal_entry' and permission.journal_entry_id is null)
        )
        and (
          permission.data_from is null
          or (p_from is not null and p_from >= permission.data_from)
        )
        and (
          permission.data_to is null
          or (p_to is not null and p_to <= permission.data_to)
        )
    ), false);
$$;

-- Vinculo ativo com profissional verificado. Usado pelo perfil basico: nome do
-- titular so aparece para quem esta, agora, num vinculo ativo e verificado.
create or replace function public.professional_relationship_is_active(p_client_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.professional_verification_is_current(auth.uid())
    and exists (
      select 1 from public.professional_connections connection
      where connection.client_user_id = p_client_user_id
        and connection.professional_user_id = auth.uid()
        and connection.status = 'active'
    ), false);
$$;

revoke all on function public.professional_relationship_is_active(uuid) from public, anon;
grant execute on function public.professional_relationship_is_active(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Policies que citavam `accepted`
-- ---------------------------------------------------------------------------

drop policy if exists profiles_select_connected_professional on public.profiles;
create policy profiles_select_connected_professional
on public.profiles for select to authenticated
using (public.professional_relationship_is_active(user_id));

-- Notas sao do profissional, nao dado do titular: exigem relationship ativa
-- (pausa, revogacao e encerramento fecham tambem as notas).
drop policy if exists professional_notes_select_professional on public.professional_notes;
create policy professional_notes_select_professional
on public.professional_notes for select to authenticated
using (
  professional_user_id = (select auth.uid())
  and exists (
    select 1 from public.professional_connections connection
    where connection.id = professional_notes.connection_id
      and connection.professional_user_id = (select auth.uid())
      and connection.status = 'active'
  )
);
drop policy if exists professional_notes_insert_professional on public.professional_notes;
create policy professional_notes_insert_professional
on public.professional_notes for insert to authenticated
with check (
  professional_user_id = (select auth.uid())
  and exists (
    select 1 from public.professional_connections connection
    where connection.id = professional_notes.connection_id
      and connection.professional_user_id = (select auth.uid())
      and connection.client_user_id = professional_notes.client_user_id
      and connection.status = 'active'
  )
);
drop policy if exists professional_notes_update_professional on public.professional_notes;
create policy professional_notes_update_professional
on public.professional_notes for update to authenticated
using (
  professional_user_id = (select auth.uid())
  and exists (
    select 1 from public.professional_connections connection
    where connection.id = professional_notes.connection_id
      and connection.professional_user_id = (select auth.uid())
      and connection.status = 'active'
  )
)
with check (professional_user_id = (select auth.uid()));
drop policy if exists professional_notes_delete_professional on public.professional_notes;
create policy professional_notes_delete_professional
on public.professional_notes for delete to authenticated
using (
  professional_user_id = (select auth.uid())
  and exists (
    select 1 from public.professional_connections connection
    where connection.id = professional_notes.connection_id
      and connection.professional_user_id = (select auth.uid())
      and connection.status = 'active'
  )
);

-- O profissional so registra a propria leitura, numa relationship ativa e com
-- verificacao vigente. Evento de ciclo de vida nunca e forjavel por ele.
drop policy if exists professional_access_log_insert_professional on public.professional_access_log;
create policy professional_access_log_insert_professional
on public.professional_access_log for insert to authenticated
with check (
  professional_user_id = (select auth.uid())
  and event_type = 'resource_viewed'
  and actor_role = 'professional'
  and outcome = 'success'
  and public.professional_relationship_is_active(client_user_id)
  and exists (
    select 1 from public.professional_connections connection
    where connection.id = professional_access_log.connection_id
      and connection.professional_user_id = (select auth.uid())
      and connection.client_user_id = professional_access_log.client_user_id
      and connection.status = 'active'
  )
);

-- ---------------------------------------------------------------------------
-- 6. RPCs de ciclo de vida (assinaturas preservadas)
-- ---------------------------------------------------------------------------

create or replace function public.invite_professional(p_professional_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  connection public.professional_connections%rowtype;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_professional_user_id = actor_id
    or not exists (
      select 1 from public.professional_profiles
      where user_id = p_professional_user_id
    ) then
    raise exception 'professional unavailable' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':' || p_professional_user_id::text, 0)
  );
  select * into connection from public.professional_connections
  where client_user_id = actor_id and professional_user_id = p_professional_user_id
  for update;

  if not found then
    insert into public.professional_connections (
      client_user_id, professional_user_id, invited_by_user_id
    ) values (actor_id, p_professional_user_id, actor_id)
    returning * into connection;
  elsif connection.status in ('revoked', 'ended') then
    update public.sharing_permissions
    set status = 'revoked', revoked_at = coalesce(revoked_at, statement_timestamp())
    where connection_id = connection.id and status = 'granted';
    update public.professional_connections
    set status = 'pending', invited_at = statement_timestamp(), accepted_at = null,
        revoked_at = null, ended_at = null, ended_by_user_id = null, paused_at = null,
        invited_by_user_id = actor_id, origin_invite_id = null
    where id = connection.id
    returning * into connection;
  end if;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, 'professional_connection.invited', 'professional_connection',
    connection.id, 'success', gen_random_uuid()
  );
  return connection.id;
end;
$$;

create or replace function public.respond_professional_invitation(
  p_connection_id uuid,
  p_accept boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  connection public.professional_connections%rowtype;
begin
  select * into connection from public.professional_connections
  where id = p_connection_id and professional_user_id = actor_id
  for update;
  if not found or connection.status <> 'pending' then
    raise exception 'pending invitation unavailable' using errcode = '42501';
  end if;
  if p_accept and not public.professional_verification_is_current(actor_id) then
    raise exception 'verified professional required' using errcode = '42501';
  end if;

  if p_accept then
    update public.professional_connections
    set status = 'active', accepted_at = statement_timestamp()
    where id = p_connection_id;
    perform public.professional_trail_append(p_connection_id, 'relationship_created', null, 'professional');
  else
    -- Recusa do pedido: nunca houve vinculo ativo. O profissional encerra.
    update public.professional_connections
    set status = 'ended', ended_at = statement_timestamp(), ended_by_user_id = actor_id
    where id = p_connection_id;
    perform public.professional_trail_append(p_connection_id, 'relationship_ended', null, 'professional');
  end if;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id,
    case when p_accept then 'professional_connection.accepted'
         else 'professional_connection.declined' end,
    'professional_connection', p_connection_id, 'success', gen_random_uuid()
  );
  return p_connection_id;
end;
$$;

-- Encerramento por qualquer participante: o titular revoga (`revoked`), o
-- profissional encerra (`ended`). Todos os grants caem na mesma transacao.
create or replace function public.revoke_professional_connection(p_connection_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  connection public.professional_connections%rowtype;
  by_client boolean;
begin
  select * into connection from public.professional_connections
  where id = p_connection_id
    and actor_id in (client_user_id, professional_user_id)
  for update;
  if not found then
    raise exception 'connection unavailable' using errcode = '42501';
  end if;
  if connection.status in ('revoked', 'ended') then return connection.id; end if;

  by_client := actor_id = connection.client_user_id;

  update public.professional_connections
  set status = case when by_client then 'revoked' else 'ended' end,
      revoked_at = case when by_client then statement_timestamp() else null end,
      ended_at = case when by_client then null else statement_timestamp() end,
      ended_by_user_id = case when by_client then null else actor_id end,
      paused_at = null
  where id = p_connection_id;

  with revoked as (
    update public.sharing_permissions
    set status = 'revoked', revoked_at = coalesce(revoked_at, statement_timestamp())
    where connection_id = p_connection_id and status = 'granted'
    returning scope
  )
  insert into public.professional_access_log (
    connection_id, client_user_id, professional_user_id, scope, event_type, actor_role
  )
  select connection.id, connection.client_user_id, connection.professional_user_id,
         revoked.scope, 'grant_revoked',
         case when by_client then 'client' else 'professional' end
  from revoked;

  perform public.professional_trail_append(
    p_connection_id,
    case when by_client then 'relationship_revoked' else 'relationship_ended' end,
    null,
    case when by_client then 'client' else 'professional' end
  );

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id,
    case when by_client then 'professional_connection.revoked'
         else 'professional_connection.ended' end,
    'professional_connection', p_connection_id, 'success', gen_random_uuid()
  );
  return p_connection_id;
end;
$$;

create or replace function public.pause_professional_relationship(p_connection_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  update public.professional_connections
  set status = 'paused', paused_at = statement_timestamp()
  where id = p_connection_id and client_user_id = actor_id and status = 'active';
  if not found then
    raise exception 'active relationship required' using errcode = '42501';
  end if;
  perform public.professional_trail_append(p_connection_id, 'relationship_paused', null, 'client');
  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, 'professional_connection.paused', 'professional_connection',
    p_connection_id, 'success', gen_random_uuid()
  );
  return p_connection_id;
end;
$$;

create or replace function public.resume_professional_relationship(p_connection_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  update public.professional_connections
  set status = 'active', paused_at = null
  where id = p_connection_id and client_user_id = actor_id and status = 'paused';
  if not found then
    raise exception 'paused relationship required' using errcode = '42501';
  end if;
  perform public.professional_trail_append(p_connection_id, 'relationship_resumed', null, 'client');
  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, 'professional_connection.resumed', 'professional_connection',
    p_connection_id, 'success', gen_random_uuid()
  );
  return p_connection_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. RPCs de grant (assinaturas preservadas + vigencia)
-- ---------------------------------------------------------------------------

create or replace function public.set_sharing_permission(
  p_connection_id uuid,
  p_scope text,
  p_enabled boolean,
  p_journal_entry_id uuid default null,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  permission_id uuid;
  previous_status text;
begin
  if p_scope not in (
    'emotional', 'sleep', 'goals', 'journal_entry', 'cycle', 'reports',
    'multimodal_result', 'multimodal_transcript', 'multimodal_media',
    'multimodal_ai_interpretation'
  ) then
    raise exception 'invalid sharing scope' using errcode = '22023';
  end if;
  if (p_scope = 'journal_entry') <> (p_journal_entry_id is not null) then
    raise exception 'invalid journal permission shape' using errcode = '22023';
  end if;
  if p_enabled and p_expires_at is not null and p_expires_at <= statement_timestamp() then
    raise exception 'permission expiry must be future' using errcode = '22023';
  end if;
  -- Somente o titular, numa relationship viva (ativa ou pausada). Pausada
  -- aceita preparar grants: a leitura continua negada ate a retomada.
  if not exists (
    select 1 from public.professional_connections
    where id = p_connection_id and client_user_id = actor_id
      and status in ('active', 'paused')
  ) then
    raise exception 'active relationship required' using errcode = '42501';
  end if;
  if p_scope = 'journal_entry' and not exists (
    select 1 from public.journal_entries
    where id = p_journal_entry_id and user_id = actor_id
      and status = 'saved' and trashed_at is null
  ) then
    raise exception 'owned active journal entry required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_connection_id::text || ':' || p_scope || ':' || coalesce(p_journal_entry_id::text, '-'),
      0
    )
  );
  select id, status into permission_id, previous_status from public.sharing_permissions
  where connection_id = p_connection_id
    and scope = p_scope
    and journal_entry_id is not distinct from p_journal_entry_id
  for update;

  if permission_id is null and p_enabled then
    insert into public.sharing_permissions (
      connection_id, scope, journal_entry_id, status, expires_at
    ) values (
      p_connection_id, p_scope, p_journal_entry_id, 'granted', p_expires_at
    ) returning id into permission_id;
  elsif permission_id is not null then
    update public.sharing_permissions
    set status = case when p_enabled then 'granted' else 'revoked' end,
        granted_at = case when p_enabled then statement_timestamp() else granted_at end,
        expires_at = case when p_enabled then p_expires_at else expires_at end,
        -- Reconceder recomeca a vigencia agora: um inicio futuro antigo nao
        -- sobrevive a revogacao.
        valid_from = case when p_enabled then null else valid_from end,
        revoked_at = case when p_enabled then null else statement_timestamp() end
    where id = permission_id;
  end if;

  if permission_id is not null then
    perform public.professional_trail_append(
      p_connection_id,
      case
        when not p_enabled then 'grant_revoked'
        when previous_status is null then 'grant_created'
        else 'grant_changed'
      end,
      p_scope,
      'client'
    );
    insert into public.audit_logs (
      actor_user_id, action, entity_type, entity_id, outcome, correlation_id
    ) values (
      actor_id,
      case when p_enabled then 'sharing_permission.granted'
           else 'sharing_permission.revoked' end,
      'sharing_permission', permission_id, 'success', gen_random_uuid()
    );
  end if;
  return permission_id;
end;
$$;

create or replace function public.set_sharing_data_window(
  p_connection_id uuid,
  p_scope text,
  p_data_from date default null,
  p_data_to date default null,
  p_journal_entry_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  permission_id uuid;
begin
  if p_data_from is not null and p_data_to is not null and p_data_to < p_data_from then
    raise exception 'invalid data window' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.professional_connections
    where id = p_connection_id and client_user_id = actor_id
      and status in ('active', 'paused')
  ) then
    raise exception 'active relationship required' using errcode = '42501';
  end if;

  select id into permission_id from public.sharing_permissions
  where connection_id = p_connection_id
    and scope = p_scope
    and journal_entry_id is not distinct from p_journal_entry_id
  for update;
  if permission_id is null then
    raise exception 'permission not found' using errcode = '42501';
  end if;

  update public.sharing_permissions
  set data_from = p_data_from, data_to = p_data_to, updated_at = statement_timestamp()
  where id = permission_id;

  perform public.professional_trail_append(p_connection_id, 'grant_changed', p_scope, 'client');
  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, 'sharing_permission.window_set',
    'sharing_permission', permission_id, 'success', gen_random_uuid()
  );
  return permission_id;
end;
$$;

-- Vigencia do grant (`valid_from`/`valid_until`), separada de conceder e de
-- recortar a janela - tres decisoes diferentes do titular.
create or replace function public.set_sharing_grant_validity(
  p_connection_id uuid,
  p_scope text,
  p_valid_from timestamptz default null,
  p_valid_until timestamptz default null,
  p_journal_entry_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  permission_id uuid;
begin
  if p_valid_until is not null and p_valid_until <= statement_timestamp() then
    raise exception 'grant validity must end in the future' using errcode = '22023';
  end if;
  if p_valid_from is not null and p_valid_until is not null and p_valid_until <= p_valid_from then
    raise exception 'invalid grant validity' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.professional_connections
    where id = p_connection_id and client_user_id = actor_id
      and status in ('active', 'paused')
  ) then
    raise exception 'active relationship required' using errcode = '42501';
  end if;

  select id into permission_id from public.sharing_permissions
  where connection_id = p_connection_id
    and scope = p_scope
    and journal_entry_id is not distinct from p_journal_entry_id
    and status = 'granted'
  for update;
  if permission_id is null then
    raise exception 'permission not found' using errcode = '42501';
  end if;

  update public.sharing_permissions
  set valid_from = p_valid_from, expires_at = p_valid_until, updated_at = statement_timestamp()
  where id = permission_id;

  perform public.professional_trail_append(p_connection_id, 'grant_changed', p_scope, 'client');
  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, 'sharing_permission.validity_set',
    'sharing_permission', permission_id, 'success', gen_random_uuid()
  );
  return permission_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Aceite de convite no vocabulario novo
-- ---------------------------------------------------------------------------

create or replace function public.accept_professional_invite(p_token text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  resolved public.professional_invites%rowtype;
  connection public.professional_connections%rowtype;
  activated boolean := false;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if public.professional_invite_attempts_exceeded(actor_id) then
    raise exception 'too many invite attempts' using errcode = '54000';
  end if;

  resolved := public.professional_invite_resolve(actor_id, p_token);
  if resolved.id is null then
    perform public.professional_invite_record_denied(actor_id);
    return null;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':' || resolved.professional_user_id::text, 0)
  );
  select * into connection from public.professional_connections
  where client_user_id = actor_id
    and professional_user_id = resolved.professional_user_id
  for update;

  if not found then
    insert into public.professional_connections (
      client_user_id, professional_user_id, invited_by_user_id, status,
      accepted_at, origin_invite_id
    ) values (
      actor_id, resolved.professional_user_id, resolved.professional_user_id,
      'active', statement_timestamp(), resolved.id
    ) returning * into connection;
    activated := true;
  elsif connection.status in ('pending', 'revoked', 'ended') then
    -- Reativacao nunca ressuscita grant: todo grant anterior segue revogado.
    update public.sharing_permissions
    set status = 'revoked', revoked_at = coalesce(revoked_at, statement_timestamp())
    where connection_id = connection.id and status = 'granted';
    update public.professional_connections
    set status = 'active', accepted_at = statement_timestamp(), revoked_at = null,
        ended_at = null, ended_by_user_id = null, paused_at = null,
        invited_by_user_id = resolved.professional_user_id,
        invited_at = statement_timestamp(), origin_invite_id = resolved.id
    where id = connection.id
    returning * into connection;
    activated := true;
  end if;
  -- `active` e `paused` ficam como estao: aceitar um convite novo nunca retoma
  -- em silencio uma pausa decidida pelo titular.

  update public.professional_invites
  set state = 'accepted', accepted_at = statement_timestamp(),
      consumed_at = statement_timestamp(), redeemed_by_user_id = actor_id,
      relationship_id = connection.id
  where id = resolved.id;

  if activated then
    perform public.professional_trail_append(connection.id, 'relationship_created', null, 'client');
  end if;
  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, 'professional_invite.accepted', 'professional_connection', connection.id,
    'success', gen_random_uuid()
  );
  return connection.id;
end;
$$;

revoke all on function public.pause_professional_relationship(uuid) from public;
revoke all on function public.resume_professional_relationship(uuid) from public;
revoke all on function public.set_sharing_grant_validity(uuid, text, timestamptz, timestamptz, uuid) from public;
grant execute on function public.pause_professional_relationship(uuid) to authenticated;
grant execute on function public.resume_professional_relationship(uuid) to authenticated;
grant execute on function public.set_sharing_grant_validity(uuid, text, timestamptz, timestamptz, uuid) to authenticated;
