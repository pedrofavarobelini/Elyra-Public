-- Stage 29 — Fluxo B: a pessoa solicita acompanhamento a partir da descoberta.
--
-- Gap confirmado pela auditoria de drift (Professional-Care-Implementation-
-- Drift-Audit, GAP-01): a jornada canonica da pessoa e "descobrir -> ver fatos
-- do perfil -> criar/aceitar vinculo" e a Central de solicitacoes do
-- profissional ja recebe "pedidos de vinculo feitos pela pessoa", mas o unico
-- caminho da pessoa era `invite_professional(uuid)` (D-29-12: mantido sem UI),
-- que exige o UUID do profissional - e a descoberta so expoe o slug.
--
-- Aditiva. Nenhuma tabela nova: o pedido e a MESMA `professional_connections`
-- em `pending`, aceita/recusada pela MESMA `respond_professional_invitation`.
-- Fluxo A (convite do profissional, PRO-2) e fluxo B convergem na mesma linha.
-- Nada e compartilhado por pedir ou aceitar (grants continuam da pessoa).

-- ---------------------------------------------------------------------------
-- 1. Pedido pela descoberta
-- ---------------------------------------------------------------------------

/*
  Resolve o slug com a mesma elegibilidade da descoberta (opt-in + verificacao
  vigente) e cria ou reabre o vinculo `pending`. Idempotente para quem ja tem
  pedido aberto ou vinculo ativo/pausado. Anti-abuso no banco:
    - no maximo 5 pedidos novos por pessoa em 24 h;
    - no maximo 3 pedidos ao mesmo profissional em 30 dias;
    - recusa/encerramento pelo profissional impoe 7 dias antes de pedir de novo.
  Toda recusa por regra devolve o mesmo erro generico.
*/
create or replace function public.request_professional_connection(p_slug text)
returns table (connection_id uuid, status text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  actor uuid := auth.uid();
  pro uuid;
  connection public.professional_connections%rowtype;
  recent integer;
  notice_key uuid := gen_random_uuid();
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_slug is null or p_slug !~ '^[0-9a-f]{16}$' then
    raise exception 'professional_unavailable' using errcode = 'P0002';
  end if;
  select profile.user_id into pro
  from public.professional_public_profiles profile
  where profile.slug = p_slug
    and profile.listed
    and public.professional_verification_is_current(profile.user_id);
  if pro is null or pro = actor then
    raise exception 'professional_unavailable' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor::text || ':' || pro::text, 0)
  );
  select * into connection from public.professional_connections c
  where c.client_user_id = actor and c.professional_user_id = pro
  for update;

  if connection.id is not null and connection.status in ('pending', 'active', 'paused') then
    return query select connection.id, connection.status;
    return;
  end if;

  if connection.id is null then
    select count(*) into recent from public.audit_logs log
    where log.actor_user_id = actor
      and log.action = 'professional_connection.requested'
      and log.occurred_at > statement_timestamp() - interval '24 hours';
    if recent >= 5 then
      raise exception 'request_limit' using errcode = '54000';
    end if;
    insert into public.professional_connections (client_user_id, professional_user_id, invited_by_user_id)
    values (actor, pro, actor)
    returning * into connection;
  else
    select count(*) into recent from public.audit_logs log
    where log.actor_user_id = actor
      and log.action = 'professional_connection.requested'
      and log.entity_id = connection.id
      and log.occurred_at > statement_timestamp() - interval '30 days';
    if recent >= 3
       or (connection.status = 'ended' and connection.ended_by_user_id = pro
           and connection.ended_at > statement_timestamp() - interval '7 days') then
      raise exception 'request_limit' using errcode = '54000';
    end if;
    -- Reabrir: tudo o que havia de grant ja caiu no encerramento; reforca.
    update public.sharing_permissions
    set status = 'revoked', revoked_at = coalesce(revoked_at, statement_timestamp())
    where connection_id = connection.id and status = 'granted';
    update public.professional_connections c
    set status = 'pending', invited_at = statement_timestamp(), accepted_at = null,
        revoked_at = null, ended_at = null, ended_by_user_id = null, paused_at = null,
        invited_by_user_id = actor, origin_invite_id = null
    where c.id = connection.id
    returning * into connection;
  end if;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, outcome, correlation_id)
  values (actor, 'professional_connection.requested', 'professional_connection', connection.id, 'success', notice_key);

  if public.notification_channel_delivers(pro, 'connection_requested', 'in_app') then
    insert into public.notifications (user_id, kind, event_key)
    values (pro, 'connection_requested', 'connection_requested:' || notice_key::text)
    on conflict (user_id, event_key) do nothing;
  end if;

  return query select connection.id, connection.status;
end;
$$;

revoke all on function public.request_professional_connection(text) from public, anon, service_role;
grant execute on function public.request_professional_connection(text) to authenticated;

/*
  Situacao do vinculo de quem pergunta com o profissional daquele perfil
  publico, em qualquer estado. So a propria linha (a pessoa ja a le pela RLS);
  nunca vinculo de terceiros, nunca o user_id do profissional.
*/
create or replace function public.my_connection_for_directory_slug(p_slug text)
returns table (connection_id uuid, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select connection.id, connection.status
  from public.professional_public_profiles profile
  join public.professional_connections connection
    on connection.professional_user_id = profile.user_id
  where profile.slug = p_slug
    and profile.listed
    and public.professional_verification_is_current(profile.user_id)
    and connection.client_user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.my_connection_for_directory_slug(text) from public, anon, service_role;
grant execute on function public.my_connection_for_directory_slug(text) to authenticated;

/*
  Nome do profissional em cada vinculo da propria pessoa (drift de UX: a tela
  mostrava "Profissional <uuid>"). Projecao fixa: nome publico do perfil, senao
  o display_name do profile. So as conexoes em que quem pergunta e o titular.
*/
create or replace function public.list_my_connection_professional_names()
returns table (connection_id uuid, professional_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select connection.id, coalesce(public_profile.display_name, pro_profile.display_name)
  from public.professional_connections connection
  left join public.professional_public_profiles public_profile on public_profile.user_id = connection.professional_user_id
  left join public.profiles pro_profile on pro_profile.user_id = connection.professional_user_id
  where connection.client_user_id = auth.uid();
$$;

revoke all on function public.list_my_connection_professional_names() from public, anon, service_role;
grant execute on function public.list_my_connection_professional_names() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Aceite avisa a pessoa (relationship_created, evento planejado na V2)
-- ---------------------------------------------------------------------------

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
    -- Fluxo B: a pessoa que pediu fica sabendo (sem nome, sem detalhe).
    if public.notification_channel_delivers(connection.client_user_id, 'relationship_created', 'in_app') then
      insert into public.notifications (user_id, kind, event_key)
      values (connection.client_user_id, 'relationship_created', 'relationship_created:' || gen_random_uuid()::text)
      on conflict (user_id, event_key) do nothing;
    end if;
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

revoke all on function public.respond_professional_invitation(uuid, boolean) from public, anon;
grant execute on function public.respond_professional_invitation(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Dois tipos novos na matriz da Stage 29-C (sem pipeline novo)
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (
  kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice',
           'appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder',
           'session_ready', 'connection_requested', 'relationship_created')
);
alter table public.notifications drop constraint notifications_event_key_check;
alter table public.notifications add constraint notifications_event_key_check check (
  event_key ~ '^(checkin_reminder|goal_reminder|system_notice):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or event_key ~ '^weekly_digest:[0-9]{4}-W[0-9]{2}$'
  or event_key ~ '^appointment_(requested|confirmed|cancelled|reminder):[0-9a-f-]{36}$'
  or event_key ~ '^session_ready:[0-9a-f-]{36}$'
  or event_key ~ '^(connection_requested|relationship_created):[0-9a-f-]{36}$'
);

alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check check (
  kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice',
           'appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder',
           'session_ready', 'connection_requested', 'relationship_created')
);

alter table public.email_deliveries drop constraint email_deliveries_kind_check;
alter table public.email_deliveries add constraint email_deliveries_kind_check check (
  kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice',
           'appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder',
           'session_ready', 'connection_requested', 'relationship_created')
);
alter table public.email_deliveries drop constraint email_deliveries_event_key_check;
alter table public.email_deliveries add constraint email_deliveries_event_key_check check (
  event_key ~ '^(checkin_reminder|goal_reminder|system_notice):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or event_key ~ '^weekly_digest:[0-9]{4}-W[0-9]{2}$'
  or event_key ~ '^appointment_(requested|confirmed|cancelled|reminder):[0-9a-f-]{36}$'
  or event_key ~ '^session_ready:[0-9a-f-]{36}$'
  or event_key ~ '^(connection_requested|relationship_created):[0-9a-f-]{36}$'
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
    (p_user_id, 'relationship_created', 'email', false)
  on conflict (user_id, kind, channel) do nothing;
end;
$$;

-- Contas existentes ganham as linhas novas (idempotente).
select public.seed_notification_preferences(profile.user_id) from public.profiles profile;

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
    'session_ready', 'connection_requested', 'relationship_created'
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
