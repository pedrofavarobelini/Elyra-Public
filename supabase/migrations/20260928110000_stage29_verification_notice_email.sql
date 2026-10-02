-- ---------------------------------------------------------------------------
-- Stage 29 / Pre-closure - L-323: e-mail de "Cadastro profissional".
--
-- Migration **aditiva** (substitui 2 funcoes, mesma assinatura; nenhuma tabela
-- nova, nenhuma linha existente muda). Antes, o interruptor de e-mail do tipo
-- `professional_verification_update` era oferecido e ligavel, mas nada o
-- entregava: o aviso so virava linha in-app e `due_notification_emails` nunca
-- enxergava o tipo (viola "canal indisponivel se declara").
--
-- Correcao pela infraestrutura existente (mesmo padrao do fluxo B):
-- `professional_verification_notify` passa a gravar SEMPRE uma linha de
-- auditoria sem conteudo (`professional_verification.notice_created`, entidade
-- = a conta, correlation = id do evento) e usa o mesmo id no aviso in-app. O
-- dispatcher le essa linha pela preferencia de e-mail da pessoa. O texto do
-- e-mail continua generico (template existente); nunca diz aprovado/recusado.
-- ---------------------------------------------------------------------------

create or replace function public.professional_verification_notify(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id uuid := gen_random_uuid();
begin
  if p_user_id is null then
    return;
  end if;
  -- Fonte do evento para outros canais: sem conteudo, sem status, sem motivo.
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, outcome, correlation_id)
  values (null, 'professional_verification.notice_created', 'professional_profile', p_user_id, 'success', event_id);
  if public.notification_channel_delivers(p_user_id, 'professional_verification_update', 'in_app') then
    insert into public.notifications (user_id, kind, event_key)
    values (p_user_id, 'professional_verification_update',
            'professional_verification_update:' || event_id::text)
    on conflict (user_id, event_key) do nothing;
  end if;
end;
$$;

revoke all on function public.professional_verification_notify(uuid) from public, anon, authenticated, service_role;

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
    union all
    -- L-323: mudanca no cadastro/verificacao profissional. A fonte e a linha de
    -- auditoria gravada por `professional_verification_notify` (uma por evento),
    -- independente do canal in-app. O e-mail nunca diz qual foi a mudanca.
    select log.entity_id, 'professional_verification_update', log.correlation_id
    from public.audit_logs log
    where log.action = 'professional_verification.notice_created'
      and log.occurred_at >= now() - interval '48 hours'
      and log.entity_id is not null
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

revoke all on function public.due_notification_emails(text, integer) from public, anon, authenticated;
grant execute on function public.due_notification_emails(text, integer) to service_role;
