-- ---------------------------------------------------------------------------
-- Stage 29-C - Communication Delivery: dispatcher de e-mail de notificacao.
--
-- Migration **aditiva**. Nenhuma linha e apagada; a unica constraint trocada
-- (`email_deliveries_transport_check`) e **ampliada** para aceitar `mailpit`.
--
-- ## O defeito que esta migration corrige (L-278)
--
-- O 23-E passou `enqueue_notification_email` e `settle_notification_email` para
-- `service_role`, mas as duas continuaram lendo `auth.uid()` e nenhuma recebe o
-- titular. Um cliente `service_role` real (JWT sem `sub`) recebe
-- `authentication required`: nenhum agendador conseguia usa-las. O pgTAP nao via
-- porque rodava como superusuario com `sub` injetado.
--
-- As funcoes antigas ficam como estao (sem chamador) para nao reescrever
-- contrato publicado sem necessidade; as novas `*_for` recebem `p_user_id`
-- explicito e nao dependem de `auth.uid()`.
--
-- ## Decisoes (ADR-0023)
--
-- - A pergunta "esta pessoa quer isto agora?" continua **so** em
--   `notification_channel_delivers` (preferencia + snooze). Nada aqui a repete.
-- - Idempotencia continua estrutural: `unique (user_id, event_key)`. Duas
--   execucoes concorrentes convergem para uma linha.
-- - Retry entre execucoes so para falha **transitoria com resposta** (408, 429,
--   5xx) e no maximo 3 liquidacoes. Timeout/rede (desfecho desconhecido) e 4xx
--   permanente nunca sao reenviados: reenviar desconhecido duplica e-mail.
-- - Fuso: a janela diaria usa o fuso **da instalacao** passado pelo dispatcher
--   (`p_timezone`). Fuso por conta continua fora (L-280, ACCEPTED).
-- - Retencao: 180 dias para `email_deliveries`, 30 para execucoes do dispatcher.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Transporte `mailpit` (captura de QA; nunca conta como `sent`)
-- ---------------------------------------------------------------------------

alter table public.email_deliveries
  drop constraint email_deliveries_transport_check;
alter table public.email_deliveries
  add constraint email_deliveries_transport_check
  check (transport in ('local_capture', 'mailpit', 'brevo'));

/*
  `sent` so existe para transporte real. Captura (local_capture, mailpit) que
  terminasse em `sent` seria o PASS falso de e-mail que a politica proibe.
*/
alter table public.email_deliveries
  add constraint email_delivery_sent_is_real
  check (status <> 'sent' or transport = 'brevo');

-- ---------------------------------------------------------------------------
-- 2. Execucoes do dispatcher (batimento, sem dado de pessoa)
-- ---------------------------------------------------------------------------

create table if not exists public.notification_dispatch_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  transport text not null check (transport in ('local_capture', 'mailpit', 'brevo')),
  outcome text not null default 'running'
    check (outcome in ('running', 'completed', 'failed', 'outside_window', 'quota_reached')),
  selected integer not null default 0 check (selected >= 0),
  delivered integer not null default 0 check (delivered >= 0),
  suppressed integer not null default 0 check (suppressed >= 0),
  failed integer not null default 0 check (failed >= 0),
  constraint notification_dispatch_runs_finished_shape check (
    (outcome = 'running' and finished_at is null)
    or (outcome <> 'running' and finished_at is not null)
  )
);

comment on table public.notification_dispatch_runs is
  'Execucoes do dispatcher de e-mail. Operacional: contagens, sem user_id, e-mail ou conteudo.';

create index if not exists notification_dispatch_runs_finished_idx
  on public.notification_dispatch_runs (finished_at desc);

alter table public.notification_dispatch_runs enable row level security;
alter table public.notification_dispatch_runs force row level security;
revoke all on table public.notification_dispatch_runs from public, anon, authenticated;
grant all on table public.notification_dispatch_runs to service_role;

-- ---------------------------------------------------------------------------
-- 3. Saude do dispatcher: o canal e-mail so aparece se ele de fato roda (L-279)
-- ---------------------------------------------------------------------------

/*
  Configuracao sozinha nao prova entrega: a chave da Brevo pode existir e nenhum
  agendador chamar o dispatcher. O canal passa a exigir uma execucao concluida
  recente. Devolve so um booleano — nenhuma contagem vaza para a sessao.
*/
create or replace function public.notification_email_dispatcher_healthy(
  p_max_age_minutes integer default 60
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.notification_dispatch_runs run
    where run.outcome in ('completed', 'outside_window', 'quota_reached')
      and run.finished_at >= timezone('utc', now())
        - make_interval(mins => greatest(1, least(coalesce(p_max_age_minutes, 60), 1440)))
  );
$$;

revoke all on function public.notification_email_dispatcher_healthy(integer)
  from public, anon;
grant execute on function public.notification_email_dispatcher_healthy(integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Quem esta elegivel nesta janela
-- ---------------------------------------------------------------------------

/*
  Linha de retry legitima: falhou com resposta transitoria e ainda nao esgotou
  as tres liquidacoes. Qualquer outra linha existente (capturada, enviada,
  pendente, falha permanente ou desconhecida) fecha a janela.
*/
create or replace function public.email_delivery_retryable(
  p_status text,
  p_attempts smallint,
  p_failure_code text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status = 'failed'
    and p_attempts < 3
    and coalesce(p_failure_code, '') ~ '^http_(408|429|5[0-9]{2})$';
$$;

revoke all on function public.email_delivery_retryable(text, smallint, text)
  from public, anon, authenticated;
grant execute on function public.email_delivery_retryable(text, smallint, text)
  to service_role;

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
  with candidates as (
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
      -- system_notice nao tem gerador (ver migration 23): nao se inventa fato.
      and preference.kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest')
      -- So endereco com posse provada recebe e-mail.
      and account.email_confirmed_at is not null
      and account.deleted_at is null
      -- A mesma autoridade do in-app: habilitado e sem adiamento vigente.
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

revoke all on function public.due_notification_emails(text, integer)
  from public, anon, authenticated;
grant execute on function public.due_notification_emails(text, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Enfileirar por titular explicito
-- ---------------------------------------------------------------------------

/*
  Devolve o `id` quando esta execucao ganhou o direito de enviar; `null` quando
  nao deve (desligado, adiado, ja entregue, pendente em outra execucao, falha
  nao repetivel).

  Concorrencia: duas execucoes batem no mesmo `unique`. A primeira insere ou
  reabre uma falha transitoria; a segunda encontra a linha `pending` e o
  `where` do `do update` a recusa — sob o lock da linha, a condicao e reavaliada
  com o valor ja atualizado.
*/
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
  if p_kind is null or p_kind not in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice') then
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

revoke all on function public.enqueue_notification_email_for(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_notification_email_for(uuid, text, text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Liquidar com o status real
-- ---------------------------------------------------------------------------

/*
  So liquida linha `pending`: repetir a chamada (replay) nao reescreve uma
  entrega ja registrada. `sent` exige transporte `brevo` (constraint acima);
  captura liquida como `captured`. O codigo de falha e rotulo fechado — qualquer
  coisa fora do formato vira `transport_error`, para nenhum texto de provedor
  (que pode ecoar endereco) chegar ao banco.
*/
create or replace function public.settle_notification_email_for(
  p_delivery_id uuid,
  p_status text,
  p_failure_code text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  code text;
  touched integer;
begin
  if p_status is null or p_status not in ('captured', 'sent', 'failed') then
    raise exception 'invalid status' using errcode = '22023';
  end if;

  code := case
    when p_status <> 'failed' then null
    when coalesce(p_failure_code, '') ~ '^[a-z0-9_]{1,40}$' then p_failure_code
    else 'transport_error'
  end;

  update public.email_deliveries
  set
    status = p_status,
    delivered_at = case when p_status in ('captured', 'sent') then timezone('utc', now()) else null end,
    failure_code = code,
    attempts = least(attempts + 1, 20)
  where id = p_delivery_id
    and status = 'pending';

  get diagnostics touched = row_count;
  return touched = 1;
end;
$$;

revoke all on function public.settle_notification_email_for(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.settle_notification_email_for(uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. Teto diario de envio
-- ---------------------------------------------------------------------------

/*
  Quantas entregas a instalacao ja consumiu nas ultimas 24 h. O dispatcher
  subtrai do teto configurado antes de pedir o lote, para um laco ou um bug
  nunca queimar a cota gratuita do provedor.
*/
create or replace function public.email_deliveries_used_since(p_since timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.email_deliveries delivery
  where delivery.updated_at >= p_since
    and delivery.status in ('pending', 'captured', 'sent');
$$;

revoke all on function public.email_deliveries_used_since(timestamptz)
  from public, anon, authenticated;
grant execute on function public.email_deliveries_used_since(timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 8. Retencao
-- ---------------------------------------------------------------------------

/*
  180 dias cobrem o direito da pessoa de ver o que lhe foi enviado (o registro
  entra no export) e qualquer janela de deduplicacao (diaria ou semanal).
  Guardar mais seria historico de comunicacao sem finalidade. O dispatcher chama
  isto ao fim de cada execucao; nao ha job separado para esquecer.
*/
create or replace function public.purge_email_delivery_history()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.email_deliveries
  where created_at < timezone('utc', now()) - interval '180 days';
  get diagnostics removed = row_count;

  delete from public.notification_dispatch_runs
  where started_at < timezone('utc', now()) - interval '30 days';

  return removed;
end;
$$;

revoke all on function public.purge_email_delivery_history()
  from public, anon, authenticated;
grant execute on function public.purge_email_delivery_history()
  to service_role;
