-- Stage 29 / PRO-2 - convite profissional seguro, separado da relationship.
--
-- **O que existia (G-02).** `invite_professional(uuid)`: a pessoa digitava o
-- UUID do profissional e criava uma conexao `pending`. Nao havia token
-- transportavel, validade, consumo unico nem revogacao do convite.
--
-- **O contrato novo.**
--   - o profissional **verificado** cria o convite; o token e gerado aqui, no
--     PostgreSQL, com `gen_random_bytes(32)` (CSPRNG), e devolvido **uma vez**;
--   - persiste apenas `sha256(token)`; o valor bruto nunca e gravado;
--   - TTL de 72 h (teto de constraint: 7 dias); expiracao nunca e revertida;
--   - single-use: aceitar ou recusar consome o token, sob `for update`;
--   - toda falha devolve o **mesmo** resultado vazio (anti-enumeracao) e grava
--     uma tentativa `denied` sem token, que alimenta um limitador no banco;
--   - aceitar cria/reativa a relationship e **nao** cria grant nenhum.
--
-- Estados: `created -> opened -> accepted` (vinculo ativado, token consumido),
-- `consumed` (token usado para recusar: nenhum vinculo), `revoked`, `expired`.
-- `expired` e efetivo pela data e materializado sob demanda.
--
-- Migration **aditiva**. A unica constraint afrouxada e
-- `professional_connection_inviter_is_client`: agora o profissional tambem pode
-- ser a origem de um vinculo (o convite e dele). Nenhuma linha muda.

create table public.professional_invites (
  id uuid primary key default gen_random_uuid(),
  professional_user_id uuid not null
    references public.professional_profiles(user_id) on delete cascade,
  token_digest bytea not null,
  state text not null default 'created'
    check (state in ('created', 'opened', 'accepted', 'consumed', 'revoked', 'expired')),
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  opened_at timestamptz,
  accepted_at timestamptz,
  consumed_at timestamptz,
  revoked_at timestamptz,
  expired_at timestamptz,
  redeemed_by_user_id uuid references public.profiles(user_id) on delete set null,
  relationship_id uuid references public.professional_connections(id) on delete set null,
  policy_version text not null default 'stage29.pro2.v1',
  constraint professional_invites_digest_unique unique (token_digest),
  constraint professional_invites_digest_length check (octet_length(token_digest) = 32),
  constraint professional_invites_ttl check (
    expires_at > created_at and expires_at <= created_at + interval '7 days'
  ),
  constraint professional_invites_state_shape check (
    (state = 'created' and opened_at is null and accepted_at is null
      and consumed_at is null and revoked_at is null and expired_at is null)
    or (state = 'opened' and opened_at is not null and accepted_at is null
      and consumed_at is null and revoked_at is null and expired_at is null)
    or (state = 'accepted' and accepted_at is not null and consumed_at is not null
      and revoked_at is null and expired_at is null)
    or (state = 'consumed' and consumed_at is not null and accepted_at is null
      and revoked_at is null and expired_at is null)
    or (state = 'revoked' and revoked_at is not null and consumed_at is null)
    or (state = 'expired' and expired_at is not null and consumed_at is null)
  )
);

comment on table public.professional_invites is
  'Convite profissional. Persiste so sha256(token); o token bruto aparece uma unica vez na criacao.';

create index professional_invites_professional_state_idx
  on public.professional_invites (professional_user_id, state, expires_at);
create index professional_invites_terminal_purge_idx
  on public.professional_invites (state, expires_at);

alter table public.professional_invites enable row level security;
alter table public.professional_invites force row level security;
revoke all on table public.professional_invites from anon, authenticated, service_role;
-- Leitura so pelo criador (e o export dele). Escrita so por RPC.
grant select on table public.professional_invites to authenticated;

create policy professional_invites_select_creator
on public.professional_invites for select to authenticated
using ((select auth.uid()) = professional_user_id);

-- Origem do vinculo: o convite que o ativou, quando houver.
alter table public.professional_connections
  add column if not exists origin_invite_id uuid
    references public.professional_invites(id) on delete set null;

alter table public.professional_connections
  drop constraint if exists professional_connection_inviter_is_client;
alter table public.professional_connections
  add constraint professional_connection_inviter_is_participant
  check (invited_by_user_id in (client_user_id, professional_user_id));

-- ---------------------------------------------------------------------------
-- Helpers internos (sem EXECUTE para clientes)
-- ---------------------------------------------------------------------------

create or replace function public.professional_invite_effective_state(
  p_state text,
  p_expires_at timestamptz
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_state in ('created', 'opened') and p_expires_at <= statement_timestamp()
      then 'expired'
    else p_state
  end;
$$;

revoke all on function public.professional_invite_effective_state(text, timestamptz) from public;
grant execute on function public.professional_invite_effective_state(text, timestamptz)
  to authenticated, service_role;

create or replace function public.professional_invite_digest(p_token text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select extensions.digest(convert_to(p_token, 'UTF8'), 'sha256');
$$;

revoke all on function public.professional_invite_digest(text) from public, anon, authenticated, service_role;

-- Limitador no banco: independe de topologia de instancia (ADR-0015). Conta
-- tentativas recusadas do proprio ator nos ultimos 10 minutos.
create or replace function public.professional_invite_attempts_exceeded(p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
    select count(*) from public.audit_logs log
    where log.actor_user_id = p_actor
      and log.action = 'professional_invite.redeem_denied'
      and log.occurred_at > statement_timestamp() - interval '10 minutes'
  ) >= 10;
$$;

revoke all on function public.professional_invite_attempts_exceeded(uuid) from public, anon, authenticated, service_role;

create or replace function public.professional_invite_record_denied(p_actor uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    p_actor, 'professional_invite.redeem_denied', 'professional_invite', null,
    'denied', gen_random_uuid()
  );
$$;

revoke all on function public.professional_invite_record_denied(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Criacao (profissional verificado)
-- ---------------------------------------------------------------------------

create or replace function public.create_professional_invite()
returns table (invite_id uuid, token text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  raw_token text;
  created public.professional_invites%rowtype;
  live_count integer;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not public.professional_verification_is_current(actor_id) then
    raise exception 'verified professional required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('professional_invite:' || actor_id::text, 0)
  );
  select count(*) into live_count from public.professional_invites invite
  where invite.professional_user_id = actor_id
    and invite.state in ('created', 'opened')
    and invite.expires_at > statement_timestamp();
  if live_count >= 20 then
    raise exception 'invite limit reached' using errcode = '54000';
  end if;

  -- 32 bytes de CSPRNG em base64url sem padding: 43 caracteres, 256 bits.
  raw_token := rtrim(
    translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'),
    '='
  );

  insert into public.professional_invites (
    professional_user_id, token_digest, expires_at
  ) values (
    actor_id,
    public.professional_invite_digest(raw_token),
    statement_timestamp() + interval '72 hours'
  ) returning * into created;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, 'professional_invite.created', 'professional_invite', created.id,
    'success', gen_random_uuid()
  );

  invite_id := created.id;
  token := raw_token;
  expires_at := created.expires_at;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Resolucao do token (compartilhada por preview/accept/decline)
--
-- Devolve o convite **somente** quando tudo vale. Qualquer outro caso devolve
-- nulo, sem distinguir "nao existe", "expirado", "revogado", "ja usado", "e o
-- proprio profissional" ou "profissional deixou de estar verificado".
-- ---------------------------------------------------------------------------

create or replace function public.professional_invite_resolve(
  p_actor uuid,
  p_token text
)
returns public.professional_invites
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  found_invite public.professional_invites%rowtype;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return null;
  end if;
  select * into found_invite from public.professional_invites
  where token_digest = public.professional_invite_digest(p_token)
  for update;
  if not found then
    return null;
  end if;
  if found_invite.state in ('created', 'opened')
    and found_invite.expires_at <= statement_timestamp() then
    -- Materializa a expiracao. Nunca e revertida.
    update public.professional_invites
    set state = 'expired', expired_at = statement_timestamp()
    where id = found_invite.id;
    return null;
  end if;
  if found_invite.state not in ('created', 'opened')
    or found_invite.professional_user_id = p_actor
    or not public.professional_verification_is_current(found_invite.professional_user_id) then
    return null;
  end if;
  return found_invite;
end;
$$;

revoke all on function public.professional_invite_resolve(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.preview_professional_invite(p_token text)
returns table (
  invite_id uuid,
  professional_display_name text,
  council text,
  council_region text,
  registration_number text,
  specialty text,
  expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  resolved public.professional_invites%rowtype;
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
    return;
  end if;

  if resolved.state = 'created' then
    update public.professional_invites
    set state = 'opened', opened_at = statement_timestamp()
    where id = resolved.id;
    insert into public.audit_logs (
      actor_user_id, action, entity_type, entity_id, outcome, correlation_id
    ) values (
      actor_id, 'professional_invite.opened', 'professional_invite', resolved.id,
      'success', gen_random_uuid()
    );
  end if;

  -- Somente fatos que ajudam a pessoa a decidir com quem esta se vinculando.
  return query
  select resolved.id, person.display_name, profile.council, profile.council_region,
         profile.registration_number, profile.specialty, resolved.expires_at
  from public.professional_profiles profile
  join public.profiles person on person.user_id = profile.user_id
  where profile.user_id = resolved.professional_user_id;
end;
$$;

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
      'accepted', statement_timestamp(), resolved.id
    ) returning * into connection;
  elsif connection.status <> 'accepted' then
    -- Reativacao nunca ressuscita grant: todo grant anterior segue revogado.
    update public.sharing_permissions
    set status = 'revoked', revoked_at = coalesce(revoked_at, statement_timestamp())
    where connection_id = connection.id and status = 'granted';
    update public.professional_connections
    set status = 'accepted', accepted_at = statement_timestamp(), revoked_at = null,
        invited_by_user_id = resolved.professional_user_id,
        invited_at = statement_timestamp(), origin_invite_id = resolved.id
    where id = connection.id
    returning * into connection;
  end if;

  update public.professional_invites
  set state = 'accepted', accepted_at = statement_timestamp(),
      consumed_at = statement_timestamp(), redeemed_by_user_id = actor_id,
      relationship_id = connection.id
  where id = resolved.id;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, 'professional_invite.accepted', 'professional_connection', connection.id,
    'success', gen_random_uuid()
  );
  return connection.id;
end;
$$;

create or replace function public.decline_professional_invite(p_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  resolved public.professional_invites%rowtype;
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
    return false;
  end if;

  update public.professional_invites
  set state = 'consumed', consumed_at = statement_timestamp(),
      redeemed_by_user_id = actor_id
  where id = resolved.id;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, 'professional_invite.declined', 'professional_invite', resolved.id,
    'success', gen_random_uuid()
  );
  return true;
end;
$$;

create or replace function public.revoke_professional_invite(p_invite_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target public.professional_invites%rowtype;
begin
  select * into target from public.professional_invites
  where id = p_invite_id and professional_user_id = actor_id
  for update;
  if not found then
    raise exception 'invite unavailable' using errcode = '42501';
  end if;
  if public.professional_invite_effective_state(target.state, target.expires_at)
     not in ('created', 'opened') then
    -- Terminal (aceito, recusado, expirado, ja revogado): nada a revogar.
    raise exception 'invite not revocable' using errcode = '22023';
  end if;

  update public.professional_invites
  set state = 'revoked', revoked_at = statement_timestamp()
  where id = target.id;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, 'professional_invite.revoked', 'professional_invite', target.id,
    'success', gen_random_uuid()
  );
  return target.id;
end;
$$;

create or replace function public.list_my_professional_invites()
returns table (
  id uuid,
  state text,
  created_at timestamptz,
  expires_at timestamptz,
  opened_at timestamptz,
  accepted_at timestamptz,
  consumed_at timestamptz,
  revoked_at timestamptz,
  relationship_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select invite.id,
         public.professional_invite_effective_state(invite.state, invite.expires_at),
         invite.created_at, invite.expires_at, invite.opened_at, invite.accepted_at,
         invite.consumed_at, invite.revoked_at, invite.relationship_id
  from public.professional_invites invite
  where invite.professional_user_id = auth.uid()
  order by invite.created_at desc
  limit 50;
$$;

-- Job operacional (D-29-13): apaga convite terminal/expirado 30 dias depois.
create or replace function public.purge_professional_invites()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  delete from public.professional_invites invite
  where (
      invite.state in ('accepted', 'consumed', 'revoked', 'expired')
      or invite.expires_at <= statement_timestamp()
    )
    and greatest(
      invite.expires_at, invite.accepted_at, invite.consumed_at,
      invite.revoked_at, invite.expired_at
    ) < statement_timestamp() - interval '30 days';
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.create_professional_invite() from public;
revoke all on function public.preview_professional_invite(text) from public;
revoke all on function public.accept_professional_invite(text) from public;
revoke all on function public.decline_professional_invite(text) from public;
revoke all on function public.revoke_professional_invite(uuid) from public;
revoke all on function public.list_my_professional_invites() from public;
revoke all on function public.purge_professional_invites() from public, anon, authenticated;

grant execute on function public.create_professional_invite() to authenticated;
grant execute on function public.preview_professional_invite(text) to authenticated;
grant execute on function public.accept_professional_invite(text) to authenticated;
grant execute on function public.decline_professional_invite(text) to authenticated;
grant execute on function public.revoke_professional_invite(uuid) to authenticated;
grant execute on function public.list_my_professional_invites() to authenticated;
grant execute on function public.purge_professional_invites() to service_role;
