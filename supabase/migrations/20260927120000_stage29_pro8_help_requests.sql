-- Stage 29 / PRO-8 — Pedidos de ajuda (assincronos, dentro de vinculo ativo).
--
-- nova, dois tipos de aviso novos, funcoes novas. Nada existente e alterado
-- alem das listas fechadas de `kind`.
--
-- HELP_REQUEST != SOS. Um pedido nao aciona o SOS, nao promete resposta, nao
-- tem prazo e nao e monitorado. Por isso:
--   - nao existe estado "assumido" (CLAIMED): so fatos - enviado, lido,
--     respondido, encerrado (D-PRO8-5);
--   - o profissional NAO escreve resposta aqui (D-PRO8-6, pergunta juridica
--     aberta): ele marca "respondi" e responde pelo canal que ja usam;
--   - o texto e da pessoa, curto (1-1000), sem anexo (D-PRO8-3), e e apagado
--     30 dias depois do fim (D-PRO8-1). O que resta e a linha sem conteudo.
--
-- Valores de politica (padroes assumidos, pendentes de confirmacao do owner):
--   janela de espera 7 dias · retencao do texto 30 dias apos o fim ·
--   1 pedido em espera por vinculo · 3 pedidos por pessoa em 24 h.

-- ---------------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------------

create table public.help_requests (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.professional_connections(id) on delete cascade,
  client_user_id uuid not null references public.profiles(user_id) on delete cascade,
  professional_user_id uuid not null references public.profiles(user_id) on delete cascade,
  status text not null default 'open'
    check (status in ('open', 'seen', 'responded', 'closed', 'cancelled', 'expired')),
  body text,
  idempotency_key uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  seen_at timestamptz,
  responded_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references public.profiles(user_id) on delete set null,
  body_purged_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint help_requests_distinct_participants check (client_user_id <> professional_user_id),
  constraint help_requests_idempotency unique (client_user_id, idempotency_key),
  constraint help_requests_body_length check (
    body is null or char_length(body) between 1 and 1000
  ),
  -- Texto some so pela retencao, e so depois do fim.
  constraint help_requests_body_purge_shape check (
    (body is not null and body_purged_at is null)
    or (body is null and body_purged_at is not null and status in ('closed', 'cancelled', 'expired'))
  ),
  constraint help_requests_window check (expires_at > created_at),
  constraint help_requests_status_shape check (
    (status = 'open' and seen_at is null and responded_at is null and ended_at is null)
    or (status = 'seen' and seen_at is not null and responded_at is null and ended_at is null)
    or (status = 'responded' and responded_at is not null and ended_at is null)
    or (status in ('closed', 'cancelled', 'expired') and ended_at is not null)
  )
);

comment on table public.help_requests is
  'Pedido de ajuda assincrono (PRO-8). Nao e SOS, nao tem prazo. Escrita so por RPC; texto apagado 30 dias apos o fim.';
comment on column public.help_requests.body is
  'Texto da pessoa. Nunca vai para notificacao, e-mail, audit log ou log de aplicacao.';

-- Um pedido em espera (enviado ou lido) por vinculo.
create unique index help_requests_one_waiting_per_connection
  on public.help_requests (connection_id) where (status in ('open', 'seen'));
create index help_requests_client_time_idx on public.help_requests (client_user_id, created_at desc);
create index help_requests_professional_time_idx on public.help_requests (professional_user_id, created_at desc);
create index help_requests_retention_idx on public.help_requests (ended_at) where (body is not null);

create trigger help_requests_set_updated_at
before update on public.help_requests
for each row execute function public.set_updated_at();

alter table public.help_requests enable row level security;
alter table public.help_requests force row level security;
revoke all on table public.help_requests from public, anon, authenticated;
grant select on table public.help_requests to authenticated;
grant all on table public.help_requests to service_role;

-- A pessoa le os proprios pedidos sempre. O profissional so enquanto o vinculo
-- esta ativo e a verificacao dele vale: revogar corta a leitura na hora.
create policy help_requests_select_client
on public.help_requests for select to authenticated
using ((select auth.uid()) = client_user_id);

-- `professional_verification_is_current` e privada e a policy roda como o
-- usuario: o teste de leitura do profissional fica neste helper definer, que
-- so responde sobre o proprio auth.uid().
create or replace function public.help_request_professional_can_read(p_connection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.professional_connections connection
    where connection.id = p_connection_id
      and connection.professional_user_id = auth.uid()
      and connection.status = 'active'
  ) and public.professional_verification_is_current(auth.uid());
$$;

revoke all on function public.help_request_professional_can_read(uuid) from public, anon, service_role;
grant execute on function public.help_request_professional_can_read(uuid) to authenticated;

create policy help_requests_select_professional
on public.help_requests for select to authenticated
using (
  (select auth.uid()) = professional_user_id
  and public.help_request_professional_can_read(connection_id)
);

-- Estado efetivo: espera vencida e `expired` na leitura, antes do job materializar.
create or replace function public.help_request_effective_status(p_status text, p_expires_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_status in ('open', 'seen') and p_expires_at <= statement_timestamp() then 'expired'
    else p_status
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Dois avisos novos (sem conteudo, sem nome)
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (
  kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice',
           'appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder',
           'session_ready', 'connection_requested', 'relationship_created',
           'professional_verification_update', 'help_request_received', 'help_request_updated')
);
alter table public.notifications drop constraint notifications_event_key_check;
alter table public.notifications add constraint notifications_event_key_check check (
  event_key ~ '^(checkin_reminder|goal_reminder|system_notice):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or event_key ~ '^weekly_digest:[0-9]{4}-W[0-9]{2}$'
  or event_key ~ '^appointment_(requested|confirmed|cancelled|reminder):[0-9a-f-]{36}$'
  or event_key ~ '^session_ready:[0-9a-f-]{36}$'
  or event_key ~ '^(connection_requested|relationship_created):[0-9a-f-]{36}$'
  or event_key ~ '^professional_verification_update:[0-9a-f-]{36}$'
  or event_key ~ '^help_request_(received|updated):[0-9a-f-]{36}$'
);

alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check check (
  kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice',
           'appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder',
           'session_ready', 'connection_requested', 'relationship_created',
           'professional_verification_update', 'help_request_received', 'help_request_updated')
);

alter table public.email_deliveries drop constraint email_deliveries_kind_check;
alter table public.email_deliveries add constraint email_deliveries_kind_check check (
  kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice',
           'appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder',
           'session_ready', 'connection_requested', 'relationship_created',
           'professional_verification_update', 'help_request_received', 'help_request_updated')
);
alter table public.email_deliveries drop constraint email_deliveries_event_key_check;
alter table public.email_deliveries add constraint email_deliveries_event_key_check check (
  event_key ~ '^(checkin_reminder|goal_reminder|system_notice):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or event_key ~ '^weekly_digest:[0-9]{4}-W[0-9]{2}$'
  or event_key ~ '^appointment_(requested|confirmed|cancelled|reminder):[0-9a-f-]{36}$'
  or event_key ~ '^session_ready:[0-9a-f-]{36}$'
  or event_key ~ '^(connection_requested|relationship_created):[0-9a-f-]{36}$'
  or event_key ~ '^professional_verification_update:[0-9a-f-]{36}$'
  or event_key ~ '^help_request_(received|updated):[0-9a-f-]{36}$'
);

create or replace function public.seed_notification_preferences(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  legacy public.user_preferences%rowtype;
begin
  select * into legacy
  from public.user_preferences
  where user_id = p_user_id;

  insert into public.notification_preferences (user_id, kind, channel, enabled)
  values
    (p_user_id, 'checkin_reminder', 'in_app', coalesce(legacy.checkin_reminder, true)),
    (p_user_id, 'goal_reminder',    'in_app', coalesce(legacy.goal_reminder, true)),
    (p_user_id, 'weekly_digest',    'in_app', false),
    (p_user_id, 'system_notice',    'in_app', true),
    (p_user_id, 'checkin_reminder', 'web_push', false),
    (p_user_id, 'goal_reminder',    'web_push', false),
    (p_user_id, 'weekly_digest',    'web_push', false),
    (p_user_id, 'system_notice',    'web_push', false),
    (p_user_id, 'checkin_reminder', 'email', false),
    (p_user_id, 'goal_reminder',    'email', false),
    (p_user_id, 'weekly_digest',    'email', false),
    (p_user_id, 'system_notice',    'email', false),
    (p_user_id, 'appointment_requested', 'in_app', true),
    (p_user_id, 'appointment_confirmed', 'in_app', true),
    (p_user_id, 'appointment_cancelled', 'in_app', true),
    (p_user_id, 'appointment_reminder',  'in_app', true),
    (p_user_id, 'appointment_requested', 'web_push', false),
    (p_user_id, 'appointment_confirmed', 'web_push', false),
    (p_user_id, 'appointment_cancelled', 'web_push', false),
    (p_user_id, 'appointment_reminder',  'web_push', false),
    (p_user_id, 'appointment_requested', 'email', false),
    (p_user_id, 'appointment_confirmed', 'email', false),
    (p_user_id, 'appointment_cancelled', 'email', false),
    (p_user_id, 'appointment_reminder',  'email', false),
    (p_user_id, 'session_ready', 'in_app', true),
    (p_user_id, 'session_ready', 'web_push', false),
    (p_user_id, 'session_ready', 'email', false),
    (p_user_id, 'connection_requested', 'in_app', true),
    (p_user_id, 'connection_requested', 'web_push', false),
    (p_user_id, 'connection_requested', 'email', false),
    (p_user_id, 'relationship_created', 'in_app', true),
    (p_user_id, 'relationship_created', 'web_push', false),
    (p_user_id, 'relationship_created', 'email', false),
    (p_user_id, 'professional_verification_update', 'in_app', true),
    (p_user_id, 'professional_verification_update', 'web_push', false),
    (p_user_id, 'professional_verification_update', 'email', false),
    (p_user_id, 'help_request_received', 'in_app', true),
    (p_user_id, 'help_request_received', 'web_push', false),
    (p_user_id, 'help_request_received', 'email', false),
    (p_user_id, 'help_request_updated', 'in_app', true),
    (p_user_id, 'help_request_updated', 'web_push', false),
    (p_user_id, 'help_request_updated', 'email', false)
  on conflict (user_id, kind, channel) do nothing;
end;
$$;

-- Contas existentes ganham as linhas novas (idempotente).
select public.seed_notification_preferences(profile.user_id) from public.profiles profile;

-- ---------------------------------------------------------------------------
-- 3. Aviso (so no aplicativo por padrao; e-mail nasce desligado)
-- ---------------------------------------------------------------------------

create or replace function public.help_request_notify(p_user_id uuid, p_kind text, p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind not in ('help_request_received', 'help_request_updated') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if public.notification_channel_delivers(p_user_id, p_kind, 'in_app') then
    insert into public.notifications (user_id, kind, event_key)
    values (p_user_id, p_kind, p_kind || ':' || p_request_id::text)
    on conflict (user_id, event_key) do nothing;
  end if;
end;
$$;

revoke all on function public.help_request_notify(uuid, text, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Enviar (so a pessoa, so em vinculo ativo com profissional verificado)
-- ---------------------------------------------------------------------------

create or replace function public.create_help_request(
  p_connection_id uuid,
  p_body text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  link public.professional_connections%rowtype;
  existing public.help_requests%rowtype;
  clean text := pg_catalog.btrim(p_body);
  recent integer;
  created_id uuid;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_connection_id is null or p_idempotency_key is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if clean is null or char_length(clean) < 1 or char_length(clean) > 1000 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;

  -- Replay (clique duplo, retry, segunda aba): devolve o mesmo pedido.
  select * into existing from public.help_requests
  where client_user_id = actor and idempotency_key = p_idempotency_key;
  if found then
    if existing.connection_id = p_connection_id then
      return existing.id;
    end if;
    raise exception 'idempotency_mismatch' using errcode = '22023';
  end if;

  select * into link from public.professional_connections where id = p_connection_id;
  if not found or link.client_user_id <> actor then
    raise exception 'relationship_not_found' using errcode = 'P0002';
  end if;
  if link.status <> 'active' then
    raise exception 'relationship_inactive' using errcode = '42501';
  end if;
  if not public.professional_verification_is_current(link.professional_user_id) then
    raise exception 'professional_unavailable' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('help_request:' || actor::text, 0));

  -- Espera vencida nao segura a vaga do vinculo.
  update public.help_requests request
  set status = 'expired', ended_at = request.expires_at
  where request.connection_id = link.id
    and request.status in ('open', 'seen')
    and request.expires_at <= statement_timestamp();

  if exists (
    select 1 from public.help_requests request
    where request.connection_id = link.id and request.status in ('open', 'seen')
  ) then
    raise exception 'help_request_waiting' using errcode = '23505';
  end if;

  select count(*) into recent from public.help_requests request
  where request.client_user_id = actor
    and request.created_at > statement_timestamp() - interval '24 hours';
  if recent >= 3 then
    raise exception 'help_request_limit' using errcode = '54000';
  end if;

  begin
    insert into public.help_requests (
      connection_id, client_user_id, professional_user_id, body, idempotency_key, expires_at
    ) values (
      link.id, link.client_user_id, link.professional_user_id, clean, p_idempotency_key,
      statement_timestamp() + interval '7 days'
    )
    returning id into created_id;
  exception
    when unique_violation then
      select id into created_id from public.help_requests
      where client_user_id = actor and idempotency_key = p_idempotency_key;
      if created_id is null then
        raise exception 'help_request_waiting' using errcode = '23505';
      end if;
      return created_id;
  end;

  perform public.help_request_notify(link.professional_user_id, 'help_request_received', created_id);
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, outcome, correlation_id)
  values (actor, 'help_request.created', 'help_request', created_id, 'success', gen_random_uuid());
  return created_id;
end;
$$;

revoke all on function public.create_help_request(uuid, text, uuid) from public, anon, service_role;
grant execute on function public.create_help_request(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Transicoes
--   pessoa:        cancel (enquanto enviado e nao lido) · close (depois de lido)
--   profissional:  seen · responded · close (depois de lido)
-- ---------------------------------------------------------------------------

create or replace function public.transition_help_request(p_request_id uuid, p_action text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  request public.help_requests%rowtype;
  current_status text;
  is_client boolean;
  next_status text;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('cancel', 'seen', 'responded', 'close') then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  select * into request from public.help_requests where id = p_request_id for update;
  if not found or actor not in (request.client_user_id, request.professional_user_id) then
    raise exception 'help_request_not_found' using errcode = 'P0002';
  end if;
  is_client := actor = request.client_user_id;

  -- O profissional so age com vinculo ativo e verificacao vigente; fora disso
  -- ele nem le o pedido, entao a resposta e a mesma de "nao existe".
  if not is_client and not public.help_request_professional_can_read(request.connection_id) then
    raise exception 'help_request_not_found' using errcode = 'P0002';
  end if;

  current_status := public.help_request_effective_status(request.status, request.expires_at);

  next_status := case
    when is_client and p_action = 'cancel' and current_status = 'open' then 'cancelled'
    when is_client and p_action = 'close' and current_status in ('seen', 'responded') then 'closed'
    when not is_client and p_action = 'seen' and current_status = 'open' then 'seen'
    when not is_client and p_action = 'seen' and current_status in ('seen', 'responded') then current_status
    when not is_client and p_action = 'responded' and current_status in ('open', 'seen') then 'responded'
    when not is_client and p_action = 'close' and current_status in ('seen', 'responded') then 'closed'
    else null
  end;
  if next_status is null then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if next_status = request.status then
    return next_status;  -- "lido" repetido (abrir a lista de novo) e no-op
  end if;

  update public.help_requests
  set status = next_status,
      seen_at = case when next_status in ('seen', 'responded') then coalesce(seen_at, statement_timestamp()) else seen_at end,
      responded_at = case when next_status = 'responded' then statement_timestamp() else responded_at end,
      ended_at = case when next_status in ('closed', 'cancelled') then statement_timestamp() else ended_at end,
      ended_by = case when next_status in ('closed', 'cancelled') then actor else ended_by end
  where id = request.id;

  if next_status = 'responded' then
    perform public.help_request_notify(request.client_user_id, 'help_request_updated', request.id);
  end if;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, outcome, correlation_id)
  values (actor, 'help_request.' || next_status, 'help_request', request.id, 'success', gen_random_uuid());
  return next_status;
end;
$$;

revoke all on function public.transition_help_request(uuid, text) from public, anon, service_role;
grant execute on function public.transition_help_request(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Leitura
-- ---------------------------------------------------------------------------

/*
  Os pedidos de quem pergunta, nos dois papeis, com estado efetivo e o nome da
  outra parte. Mesmas regras das policies: o profissional so ve com vinculo
  ativo e verificacao vigente. Nada de terceiros.
*/
create or replace function public.list_my_help_requests()
returns table (
  id uuid,
  connection_id uuid,
  role text,
  counterpart_name text,
  status text,
  body text,
  created_at timestamptz,
  expires_at timestamptz,
  seen_at timestamptz,
  responded_at timestamptz,
  ended_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select request.id, request.connection_id,
         case when request.client_user_id = auth.uid() then 'client' else 'professional' end,
         case when request.client_user_id = auth.uid()
              then coalesce(public_profile.display_name, pro_profile.display_name)
              else client_profile.display_name end,
         public.help_request_effective_status(request.status, request.expires_at),
         request.body, request.created_at, request.expires_at, request.seen_at,
         request.responded_at,
         case when public.help_request_effective_status(request.status, request.expires_at) = 'expired'
              then coalesce(request.ended_at, request.expires_at) else request.ended_at end
  from public.help_requests request
  left join public.professional_public_profiles public_profile on public_profile.user_id = request.professional_user_id
  left join public.profiles pro_profile on pro_profile.user_id = request.professional_user_id
  left join public.profiles client_profile on client_profile.user_id = request.client_user_id
  where request.client_user_id = auth.uid()
     or (request.professional_user_id = auth.uid()
         and public.help_request_professional_can_read(request.connection_id))
  order by request.created_at desc
  limit 200;
$$;

revoke all on function public.list_my_help_requests() from public, anon, service_role;
grant execute on function public.list_my_help_requests() to authenticated;

/*
  Para quem a pessoa pode escrever agora: vinculos ativos com profissional
  verificado, e se ja ha pedido em espera naquele vinculo.
*/
create or replace function public.list_my_help_request_targets()
returns table (connection_id uuid, professional_name text, waiting boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select connection.id,
         coalesce(public_profile.display_name, pro_profile.display_name),
         exists (
           select 1 from public.help_requests request
           where request.connection_id = connection.id
             and public.help_request_effective_status(request.status, request.expires_at) in ('open', 'seen')
         )
  from public.professional_connections connection
  left join public.professional_public_profiles public_profile on public_profile.user_id = connection.professional_user_id
  left join public.profiles pro_profile on pro_profile.user_id = connection.professional_user_id
  where connection.client_user_id = auth.uid()
    and connection.status = 'active'
    and public.professional_verification_is_current(connection.professional_user_id)
  order by 2;
$$;

revoke all on function public.list_my_help_request_targets() from public, anon, service_role;
grant execute on function public.list_my_help_request_targets() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Retencao (job de operacao; service_role)
-- ---------------------------------------------------------------------------

/*
  Materializa esperas vencidas e apaga o TEXTO 30 dias depois do fim. A linha
  fica (quem, quando, estado): o historico da pessoa continua, o conteudo nao.
*/
create or replace function public.purge_help_request_content(p_limit integer)
returns table (expired integer, purged integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n_expired integer;
  n_purged integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'invalid limit' using errcode = '22023';
  end if;

  with due as (
    select request.id from public.help_requests request
    where request.status in ('open', 'seen') and request.expires_at <= statement_timestamp()
    order by request.expires_at
    limit p_limit
    for update skip locked
  )
  update public.help_requests request
  set status = 'expired', ended_at = request.expires_at
  from due where request.id = due.id;
  get diagnostics n_expired = row_count;

  with due as (
    select request.id from public.help_requests request
    where request.body is not null
      and request.status in ('closed', 'cancelled', 'expired')
      and request.ended_at <= statement_timestamp() - interval '30 days'
    order by request.ended_at
    limit p_limit
    for update skip locked
  )
  update public.help_requests request
  set body = null, body_purged_at = statement_timestamp()
  from due where request.id = due.id;
  get diagnostics n_purged = row_count;

  return query select n_expired, n_purged;
end;
$$;

revoke all on function public.purge_help_request_content(integer) from public, anon, authenticated;
grant execute on function public.purge_help_request_content(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 8. E-mail (opt-in): os dois avisos entram na fila do dispatcher 29-C
-- ---------------------------------------------------------------------------

create or replace function public.due_notification_emails(
  p_timezone text,
  p_limit integer
)
returns table (user_id uuid, kind text, event_key text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  local_day date;
  local_week text;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'invalid limit' using errcode = '22023';
  end if;
  if p_timezone is null
    or not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_timezone) then
    raise exception 'invalid timezone' using errcode = '22023';
  end if;

  local_day := (now() at time zone p_timezone)::date;
  local_week := to_char(local_day, 'IYYY-"W"IW');

  return query
  with engagement as (
    select
      preference.user_id,
      preference.kind,
      case preference.kind
        when 'weekly_digest' then 'weekly_digest:' || local_week
        else preference.kind || ':' || to_char(local_day, 'YYYY-MM-DD')
      end as event_key
    from public.notification_preferences preference
    join auth.users account on account.id = preference.user_id
    where preference.channel = 'email'
      and preference.kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest')
      and account.email_confirmed_at is not null
      and account.deleted_at is null
      and public.notification_channel_delivers(preference.user_id, preference.kind, 'email')
      and case preference.kind
        when 'checkin_reminder' then not exists (
          select 1 from public.emotional_checkins checkin
          where checkin.user_id = preference.user_id
            and (checkin.occurred_at at time zone p_timezone)::date = local_day
        )
        when 'goal_reminder' then exists (
          select 1 from public.goals goal
          where goal.user_id = preference.user_id and goal.status = 'active'
        )
        else true
      end
  ),
  -- PRO-6: eventos de agenda nas ultimas 48 h e lembrete das proximas 24 h.
  appointment_events as (
    select appt.professional_user_id as user_id, 'appointment_requested'::text as kind, appt.id
    from public.appointments appt
    where appt.status = 'requested' and appt.requested_at >= now() - interval '48 hours'
      and appt.starts_at > now()
    union all
    select appt.client_user_id, 'appointment_confirmed', appt.id
    from public.appointments appt
    where appt.status = 'confirmed' and appt.confirmed_at >= now() - interval '48 hours'
      and appt.starts_at > now()
    union all
    select case when appt.cancelled_by = appt.client_user_id then appt.professional_user_id
                when appt.cancelled_by = appt.professional_user_id then appt.client_user_id
           end, 'appointment_cancelled', appt.id
    from public.appointments appt
    where appt.status = 'cancelled' and appt.cancelled_at >= now() - interval '48 hours'
      and appt.cancelled_by is not null and appt.starts_at > now()
    union all
    select participant.user_id, 'appointment_reminder', appt.id
    from public.appointments appt
    cross join lateral (values (appt.client_user_id), (appt.professional_user_id)) as participant(user_id)
    where appt.status = 'confirmed'
      and appt.starts_at > now() and appt.starts_at <= now() + interval '24 hours'
    union all
    -- PRO-7: sessao aberta (o id do evento e o da sessao).
    select participant.user_id, 'session_ready', session.id
    from public.professional_sessions session
    cross join lateral (values (session.client_user_id), (session.professional_user_id)) as participant(user_id)
    where session.status in ('scheduled', 'active')
      and now() >= session.opens_at and now() < session.closes_at
    union all
    -- Fluxo B: pedido de acompanhamento (ao profissional) e aceite (a pessoa).
    -- O id do evento e o correlation_id da linha de auditoria: um por pedido.
    select connection.professional_user_id, 'connection_requested', log.correlation_id
    from public.audit_logs log
    join public.professional_connections connection on connection.id = log.entity_id
    where log.action = 'professional_connection.requested'
      and log.occurred_at >= now() - interval '48 hours'
      and connection.status = 'pending'
    union all
    select connection.client_user_id, 'relationship_created', log.correlation_id
    from public.audit_logs log
    join public.professional_connections connection on connection.id = log.entity_id
    where log.action = 'professional_connection.accepted'
      and log.occurred_at >= now() - interval '48 hours'
      and connection.status = 'active'
    union all
    -- PRO-8: pedido recebido (ao profissional) e marcado como respondido (a
    -- pessoa). O id do evento e o do pedido; o texto nunca sai daqui.
    select request.professional_user_id, 'help_request_received', request.id
    from public.help_requests request
    where request.status = 'open'
      and request.created_at >= now() - interval '48 hours'
      and request.expires_at > now()
    union all
    select request.client_user_id, 'help_request_updated', request.id
    from public.help_requests request
    where request.status = 'responded'
      and request.responded_at >= now() - interval '48 hours'
  ),
  appointment as (
    select event.user_id, event.kind, event.kind || ':' || event.id::text as event_key
    from appointment_events event
    join auth.users account on account.id = event.user_id
    where account.email_confirmed_at is not null
      and account.deleted_at is null
      and public.notification_channel_delivers(event.user_id, event.kind, 'email')
  ),
  candidates as (
    select * from engagement
    union all
    select * from appointment
  )
  select candidate.user_id, candidate.kind, candidate.event_key
  from candidates candidate
  where not exists (
    select 1 from public.email_deliveries delivery
    where delivery.user_id = candidate.user_id
      and delivery.event_key = candidate.event_key
      and not public.email_delivery_retryable(delivery.status, delivery.attempts, delivery.failure_code)
  )
  order by candidate.user_id, candidate.kind
  limit p_limit;
end;
$$;

create or replace function public.enqueue_notification_email_for(
  p_user_id uuid,
  p_kind text,
  p_event_key text,
  p_transport text,
  p_subject text,
  p_body text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  claimed_id uuid;
begin
  if p_user_id is null then
    raise exception 'user required' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in (
    'checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice',
    'appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder',
    'session_ready', 'connection_requested', 'relationship_created',
    'professional_verification_update', 'help_request_received', 'help_request_updated'
  ) then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if p_transport is null or p_transport not in ('local_capture', 'mailpit', 'brevo') then
    raise exception 'invalid transport' using errcode = '22023';
  end if;

  if not public.notification_channel_delivers(p_user_id, p_kind, 'email') then
    return null;
  end if;

  insert into public.email_deliveries as delivery (
    user_id, kind, event_key, transport, subject, body
  ) values (
    p_user_id, p_kind, p_event_key, p_transport, p_subject, p_body
  )
  on conflict (user_id, event_key) do update
    set status = 'pending',
        transport = excluded.transport,
        subject = excluded.subject,
        body = excluded.body,
        failure_code = null
    where public.email_delivery_retryable(delivery.status, delivery.attempts, delivery.failure_code)
  returning delivery.id into claimed_id;

  return claimed_id;
end;
$$;
