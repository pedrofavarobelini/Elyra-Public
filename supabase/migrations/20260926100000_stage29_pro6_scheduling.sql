-- ---------------------------------------------------------------------------
-- Stage 29 / PRO-6 - Agenda profissional.
--
-- Migration **aditiva**. Tabelas novas: `professional_availability_rules` e
-- `appointments`. Constraints de notificacao sao **ampliadas** (novos tipos de
-- aviso de agenda); nenhuma linha existente muda de significado.
--
-- ## Decisoes (blueprint: Stage-29/PRO-6-Scheduling-Blueprint)
--
-- - Disponibilidade e **regra semanal** (dia, faixa em minutos, duracao do
--   horario, modalidade) num fuso IANA de regiao (`America/Sao_Paulo`), nunca
--   offset fixo. Horarios sao calculados, nao armazenados aos milhares.
-- - `appointments` guarda instantes absolutos (`timestamptz`) e o fuso da regra.
-- - Agenda serve ao **relacionamento**: pedir exige vinculo ativo e verificacao
--   vigente do profissional. Nao e marketplace: sem preco, pagamento ou ranking.
-- - Fluxo explicito: REQUESTED -> (profissional confirma) -> CONFIRMED. Pedido
--   pendente ja ocupa o horario, entao confirmar nunca cria dupla reserva.
-- - **Dupla reserva e impossivel no banco**: exclusion constraint (btree_gist)
--   por profissional e por pessoa sobre `tstzrange(starts_at, ends_at)` para
--   estados que ocupam agenda. Nao e SELECT-antes-de-INSERT.
-- - Idempotencia: `unique (requested_by, idempotency_key)`.
-- - Escrita **so** por RPC de transicao; a tabela nao tem policy de escrita.
-- - Cancelamento guarda quem, quando e um motivo de vocabulario fechado; nunca
--   texto livre ou motivo clinico. Nada e apagado.
-- ---------------------------------------------------------------------------

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Fuso IANA de regiao
-- ---------------------------------------------------------------------------

/*
  `Etc/GMT+3`, `UTC`, `-03:00` sao offsets, nao lugares: nao sabem de horario de
  verao. So nomes Regiao/Cidade reconhecidos pelo PostgreSQL passam.
*/
create or replace function public.scheduling_timezone_is_valid(p_timezone text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_timezone is not null
    and p_timezone ~ '^(Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)/[A-Za-z0-9_+\-]+(/[A-Za-z0-9_+\-]+)?$'
    and exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_timezone);
$$;

grant execute on function public.scheduling_timezone_is_valid(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Regras de disponibilidade
-- ---------------------------------------------------------------------------

create table if not exists public.professional_availability_rules (
  id uuid primary key default gen_random_uuid(),
  professional_user_id uuid not null references public.profiles(user_id) on delete cascade,
  -- 0 = domingo ... 6 = sabado (igual a `extract(dow ...)`).
  weekday smallint not null check (weekday between 0 and 6),
  start_minute smallint not null check (start_minute between 0 and 1439),
  end_minute smallint not null check (end_minute between 1 and 1440),
  slot_minutes smallint not null check (slot_minutes in (30, 45, 50, 60, 90)),
  timezone text not null,
  modality text not null check (modality in ('online', 'in_person')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint availability_window_fits_slot check (end_minute - start_minute >= slot_minutes),
  -- Duas faixas do mesmo dia nao se sobrepoem: a agenda da pessoa e uma so.
  constraint availability_rules_no_overlap exclude using gist (
    professional_user_id with =,
    weekday with =,
    int4range(start_minute, end_minute, '[)') with &&
  )
);

comment on table public.professional_availability_rules is
  'Disponibilidade semanal do profissional (PRO-6). Horarios sao calculados a partir destas regras.';

create index if not exists professional_availability_rules_pro_idx
  on public.professional_availability_rules (professional_user_id);

create trigger professional_availability_rules_set_updated_at
before update on public.professional_availability_rules
for each row execute function public.set_updated_at();

alter table public.professional_availability_rules enable row level security;
alter table public.professional_availability_rules force row level security;
revoke all on table public.professional_availability_rules from public, anon, authenticated;
grant select on table public.professional_availability_rules to authenticated;
grant all on table public.professional_availability_rules to service_role;

-- So o dono le as proprias regras. Terceiros so veem horarios calculados.
create policy professional_availability_rules_select_own
on public.professional_availability_rules for select to authenticated
using ((select auth.uid()) = professional_user_id);

-- ---------------------------------------------------------------------------
-- 3. Appointments
-- ---------------------------------------------------------------------------

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.professional_connections(id) on delete cascade,
  client_user_id uuid not null references public.profiles(user_id) on delete cascade,
  professional_user_id uuid not null references public.profiles(user_id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null,
  modality text not null check (modality in ('online', 'in_person')),
  status text not null default 'requested'
    check (status in ('requested', 'confirmed', 'cancelled', 'completed', 'no_show')),
  requested_by uuid not null references public.profiles(user_id) on delete cascade,
  requested_at timestamptz not null default timezone('utc', now()),
  idempotency_key uuid not null,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(user_id) on delete set null,
  cancel_reason text check (
    cancel_reason in ('declined', 'schedule_change', 'unavailable', 'relationship_ended', 'other')
  ),
  completed_at timestamptz,
  no_show_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint appointments_distinct_participants check (client_user_id <> professional_user_id),
  constraint appointments_duration check (
    ends_at > starts_at and ends_at - starts_at <= interval '4 hours'
  ),
  constraint appointments_idempotency unique (requested_by, idempotency_key),
  constraint appointments_status_shape check (
    (status = 'requested' and confirmed_at is null and cancelled_at is null and completed_at is null and no_show_at is null)
    or (status = 'confirmed' and confirmed_at is not null and cancelled_at is null and completed_at is null and no_show_at is null)
    or (status = 'cancelled' and cancelled_at is not null and cancel_reason is not null and completed_at is null and no_show_at is null)
    or (status = 'completed' and confirmed_at is not null and completed_at is not null and cancelled_at is null and no_show_at is null)
    or (status = 'no_show' and confirmed_at is not null and no_show_at is not null and cancelled_at is null and completed_at is null)
  ),
  /*
    O ponto central do PRO-6. Pedido e confirmado ocupam a agenda; cancelado,
    concluido e falta nao. Duas transacoes simultaneas disputando o mesmo
    horario: a segunda recebe 23P01, nunca uma segunda linha.
  */
  constraint appointments_no_double_booking_professional exclude using gist (
    professional_user_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('requested', 'confirmed')),
  constraint appointments_no_double_booking_client exclude using gist (
    client_user_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('requested', 'confirmed'))
);

comment on table public.appointments is
  'Horarios entre pessoa e profissional (PRO-6). Escrita so por RPC de transicao; sem motivo clinico.';
comment on column public.appointments.cancel_reason is
  'Vocabulario fechado. Nunca texto livre nem motivo clinico.';

create index if not exists appointments_professional_time_idx
  on public.appointments (professional_user_id, starts_at);
create index if not exists appointments_client_time_idx
  on public.appointments (client_user_id, starts_at);
create index if not exists appointments_status_time_idx
  on public.appointments (status, starts_at);

create trigger appointments_set_updated_at
before update on public.appointments
for each row execute function public.set_updated_at();

alter table public.appointments enable row level security;
alter table public.appointments force row level security;
revoke all on table public.appointments from public, anon, authenticated;
grant select on table public.appointments to authenticated;
grant all on table public.appointments to service_role;

-- Participantes, e so eles. Nenhuma policy de escrita: transicao e RPC.
create policy appointments_select_participant
on public.appointments for select to authenticated
using ((select auth.uid()) in (client_user_id, professional_user_id));

-- ---------------------------------------------------------------------------
-- 4. Notificacoes de agenda (amplia o contrato existente)
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (
  kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice',
           'appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder')
);
alter table public.notifications drop constraint notifications_event_key_check;
alter table public.notifications add constraint notifications_event_key_check check (
  event_key ~ '^(checkin_reminder|goal_reminder|system_notice):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or event_key ~ '^weekly_digest:[0-9]{4}-W[0-9]{2}$'
  or event_key ~ '^appointment_(requested|confirmed|cancelled|reminder):[0-9a-f-]{36}$'
);

alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check check (
  kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice',
           'appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder')
);

alter table public.email_deliveries drop constraint email_deliveries_kind_check;
alter table public.email_deliveries add constraint email_deliveries_kind_check check (
  kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice',
           'appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder')
);
alter table public.email_deliveries drop constraint email_deliveries_event_key_check;
alter table public.email_deliveries add constraint email_deliveries_event_key_check check (
  event_key ~ '^(checkin_reminder|goal_reminder|system_notice):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or event_key ~ '^weekly_digest:[0-9]{4}-W[0-9]{2}$'
  or event_key ~ '^appointment_(requested|confirmed|cancelled|reminder):[0-9a-f-]{36}$'
);

/*
  Semeadura ampliada. Aviso in-app de agenda nasce LIGADO: e recibo de uma acao
  que a propria pessoa (ou o profissional com quem ela tem vinculo) iniciou, e a
  agenda perde sentido se o pedido chega em silencio. Push e e-mail continuam
  nascendo desligados, sem excecao.
*/
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
    (p_user_id, 'appointment_reminder',  'email', false)
  on conflict (user_id, kind, channel) do nothing;
end;
$$;

-- Contas existentes ganham as linhas novas (idempotente).
select public.seed_notification_preferences(profile.user_id) from public.profiles profile;

/*
  Aviso in-app de evento: nasce na propria transicao, na mesma transacao, e so
  se o par (tipo, in_app) entrega. `on conflict do nothing` pelo unique
  (user_id, event_key): repetir a transicao nao duplica.
*/
create or replace function public.appointment_notify(
  p_user_id uuid,
  p_kind text,
  p_appointment_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.notification_channel_delivers(p_user_id, p_kind, 'in_app') then
    insert into public.notifications (user_id, kind, event_key)
    values (p_user_id, p_kind, p_kind || ':' || p_appointment_id::text)
    on conflict (user_id, event_key) do nothing;
  end if;
end;
$$;

revoke all on function public.appointment_notify(uuid, text, uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Horario oferecido? (servidor decide, nunca o frontend)
-- ---------------------------------------------------------------------------

/*
  Devolve o fim e o fuso do horario quando `p_starts_at` cai exatamente numa
  grade oferecida por uma regra ativa com a modalidade pedida. A conversao
  `instante at time zone fuso` e a do PostgreSQL, que conhece horario de verao.
*/
create or replace function public.professional_slot_offer(
  p_professional_user_id uuid,
  p_starts_at timestamptz,
  p_modality text
)
returns table (ends_at timestamptz, timezone text)
language sql
stable
security definer
set search_path = ''
as $$
  select p_starts_at + make_interval(mins => rule.slot_minutes), rule.timezone
  from public.professional_availability_rules rule
  cross join lateral (
    select (p_starts_at at time zone rule.timezone) as local_ts
  ) local
  cross join lateral (
    select (extract(hour from local.local_ts) * 60 + extract(minute from local.local_ts))::int as minute_of_day
  ) m
  where rule.professional_user_id = p_professional_user_id
    and rule.modality = p_modality
    and extract(dow from local.local_ts) = rule.weekday
    and extract(second from local.local_ts) = 0
    and m.minute_of_day >= rule.start_minute
    and m.minute_of_day + rule.slot_minutes <= rule.end_minute
    and (m.minute_of_day - rule.start_minute) % rule.slot_minutes = 0
  limit 1;
$$;

revoke all on function public.professional_slot_offer(uuid, timestamptz, text)
  from public, anon, authenticated, service_role;

-- Antecedencia minima e horizonte: nada para daqui a 5 minutos, nada para 2027.
create or replace function public.scheduling_window_ok(p_starts_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_starts_at >= statement_timestamp() + interval '60 minutes'
     and p_starts_at <= statement_timestamp() + interval '60 days';
$$;

-- ---------------------------------------------------------------------------
-- 6. Salvar disponibilidade (substitui o conjunto, atomicamente)
-- ---------------------------------------------------------------------------

create or replace function public.save_professional_availability(
  p_timezone text,
  p_rules jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  rule jsonb;
  saved integer := 0;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.professional_verification_is_current(actor) then
    raise exception 'verification_required' using errcode = '42501';
  end if;
  if not public.scheduling_timezone_is_valid(p_timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) > 28 then
    raise exception 'invalid_rules' using errcode = '22023';
  end if;

  delete from public.professional_availability_rules where professional_user_id = actor;

  for rule in select value from jsonb_array_elements(p_rules)
  loop
    if jsonb_typeof(rule) <> 'object'
      or (rule - array['weekday','start_minute','end_minute','slot_minutes','modality']) <> '{}'::jsonb then
      raise exception 'invalid_rules' using errcode = '22023';
    end if;
    insert into public.professional_availability_rules (
      professional_user_id, weekday, start_minute, end_minute, slot_minutes, timezone, modality
    ) values (
      actor,
      (rule->>'weekday')::smallint,
      (rule->>'start_minute')::smallint,
      (rule->>'end_minute')::smallint,
      (rule->>'slot_minutes')::smallint,
      p_timezone,
      rule->>'modality'
    );
    saved := saved + 1;
  end loop;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, outcome, correlation_id)
  values (actor, 'scheduling.availability_saved', 'availability', null, 'success', gen_random_uuid());
  return saved;
exception
  when exclusion_violation then
    raise exception 'overlapping_rules' using errcode = '22023';
  when check_violation or invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    raise exception 'invalid_rules' using errcode = '22023';
end;
$$;

revoke all on function public.save_professional_availability(text, jsonb) from public, anon, service_role;
grant execute on function public.save_professional_availability(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Horarios livres (informativo; o pedido revalida tudo)
-- ---------------------------------------------------------------------------

/*
  Quem pode ver: o proprio profissional, ou a pessoa com vinculo ATIVO com ele.
  Qualquer outro recebe zero linhas (nao erro), para nao virar oraculo de "este
  profissional existe e tem agenda".
*/
create or replace function public.list_professional_open_slots(
  p_professional_user_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (starts_at timestamptz, ends_at timestamptz, modality text, timezone text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  is_client boolean;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '31 days' then
    raise exception 'invalid_range' using errcode = '22023';
  end if;

  is_client := exists (
    select 1 from public.professional_connections connection
    where connection.professional_user_id = p_professional_user_id
      and connection.client_user_id = actor
      and connection.status = 'active'
  );
  if actor <> p_professional_user_id and not is_client then
    return;
  end if;
  if not public.professional_verification_is_current(p_professional_user_id) then
    return;
  end if;

  return query
  with days as (
    select generate_series(
      (p_from at time zone 'UTC')::date - 1,
      (p_to at time zone 'UTC')::date + 1,
      interval '1 day'
    )::date as day
  ),
  candidates as (
    select distinct
      ((day.day + make_interval(mins => grid.minute)) at time zone rule.timezone) as slot_start,
      rule.slot_minutes,
      rule.modality,
      rule.timezone
    from public.professional_availability_rules rule
    cross join days day
    cross join lateral generate_series(
      rule.start_minute::int, (rule.end_minute - rule.slot_minutes)::int, rule.slot_minutes::int
    ) as grid(minute)
    where rule.professional_user_id = p_professional_user_id
      and extract(dow from day.day) = rule.weekday
  )
  select c.slot_start, c.slot_start + make_interval(mins => c.slot_minutes), c.modality, c.timezone
  from candidates c
  where c.slot_start >= greatest(p_from, statement_timestamp() + interval '60 minutes')
    and c.slot_start < p_to
    and c.slot_start <= statement_timestamp() + interval '60 days'
    -- A grade recalculada tem de bater com a regra (protege o horario de verao).
    and exists (select 1 from public.professional_slot_offer(p_professional_user_id, c.slot_start, c.modality))
    and not exists (
      select 1 from public.appointments busy
      where busy.professional_user_id = p_professional_user_id
        and busy.status in ('requested', 'confirmed')
        and tstzrange(busy.starts_at, busy.ends_at, '[)')
          && tstzrange(c.slot_start, c.slot_start + make_interval(mins => c.slot_minutes), '[)')
    )
    and (
      not is_client or not exists (
        select 1 from public.appointments mine
        where mine.client_user_id = actor
          and mine.status in ('requested', 'confirmed')
          and tstzrange(mine.starts_at, mine.ends_at, '[)')
            && tstzrange(c.slot_start, c.slot_start + make_interval(mins => c.slot_minutes), '[)')
      )
    )
  order by 1, 3
  limit 400;
end;
$$;

revoke all on function public.list_professional_open_slots(uuid, timestamptz, timestamptz) from public, anon, service_role;
grant execute on function public.list_professional_open_slots(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Pedir horario
-- ---------------------------------------------------------------------------

create or replace function public.request_appointment(
  p_connection_id uuid,
  p_starts_at timestamptz,
  p_modality text,
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
  existing public.appointments%rowtype;
  offer record;
  created_id uuid;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_connection_id is null or p_starts_at is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- Replay (clique duplo, retry, segunda aba): devolve o mesmo pedido.
  select * into existing from public.appointments
  where requested_by = actor and idempotency_key = p_idempotency_key;
  if found then
    if existing.connection_id = p_connection_id
      and existing.starts_at = p_starts_at
      and existing.modality = p_modality then
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
  if not public.scheduling_window_ok(p_starts_at) then
    raise exception 'outside_window' using errcode = '22023';
  end if;
  select * into offer from public.professional_slot_offer(link.professional_user_id, p_starts_at, p_modality);
  if not found then
    raise exception 'slot_not_offered' using errcode = '22023';
  end if;

  begin
    insert into public.appointments (
      connection_id, client_user_id, professional_user_id, starts_at, ends_at,
      timezone, modality, requested_by, idempotency_key
    ) values (
      link.id, link.client_user_id, link.professional_user_id, p_starts_at, offer.ends_at,
      offer.timezone, p_modality, actor, p_idempotency_key
    )
    returning id into created_id;
  exception
    when unique_violation then
      -- A outra aba ganhou com a mesma chave no mesmo instante.
      select id into created_id from public.appointments
      where requested_by = actor and idempotency_key = p_idempotency_key;
      return created_id;
    when exclusion_violation then
      raise exception 'slot_unavailable' using errcode = '23P01';
  end;

  perform public.appointment_notify(link.professional_user_id, 'appointment_requested', created_id);
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, outcome, correlation_id)
  values (actor, 'scheduling.appointment_requested', 'appointment', created_id, 'success', gen_random_uuid());
  return created_id;
end;
$$;

revoke all on function public.request_appointment(uuid, timestamptz, text, uuid) from public, anon, service_role;
grant execute on function public.request_appointment(uuid, timestamptz, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Transicoes
-- ---------------------------------------------------------------------------

create or replace function public.confirm_appointment(p_appointment_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  appt public.appointments%rowtype;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into appt from public.appointments where id = p_appointment_id for update;
  if not found or appt.professional_user_id <> actor then
    raise exception 'appointment_not_found' using errcode = 'P0002';
  end if;
  if appt.status <> 'requested' then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if appt.starts_at <= statement_timestamp() then
    raise exception 'appointment_past' using errcode = '22023';
  end if;
  if not public.professional_verification_is_current(actor) then
    raise exception 'verification_required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.professional_connections c where c.id = appt.connection_id and c.status = 'active'
  ) then
    raise exception 'relationship_inactive' using errcode = '42501';
  end if;

  update public.appointments
  set status = 'confirmed', confirmed_at = timezone('utc', now())
  where id = appt.id;

  perform public.appointment_notify(appt.client_user_id, 'appointment_confirmed', appt.id);
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, outcome, correlation_id)
  values (actor, 'scheduling.appointment_confirmed', 'appointment', appt.id, 'success', gen_random_uuid());
end;
$$;

create or replace function public.cancel_appointment(p_appointment_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  appt public.appointments%rowtype;
  as_professional boolean;
  other uuid;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into appt from public.appointments where id = p_appointment_id for update;
  if not found or actor not in (appt.client_user_id, appt.professional_user_id) then
    raise exception 'appointment_not_found' using errcode = 'P0002';
  end if;
  if appt.status not in ('requested', 'confirmed') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if appt.starts_at <= statement_timestamp() then
    raise exception 'appointment_past' using errcode = '22023';
  end if;

  as_professional := actor = appt.professional_user_id;
  -- Vocabulario por papel: so o profissional recusa ou se declara indisponivel.
  if p_reason is null
    or (as_professional and p_reason not in ('declined', 'unavailable', 'schedule_change', 'other'))
    or (not as_professional and p_reason not in ('schedule_change', 'other'))
    or (p_reason = 'declined' and appt.status <> 'requested') then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;

  update public.appointments
  set status = 'cancelled', cancelled_at = timezone('utc', now()),
      cancelled_by = actor, cancel_reason = p_reason
  where id = appt.id;

  other := case when as_professional then appt.client_user_id else appt.professional_user_id end;
  perform public.appointment_notify(other, 'appointment_cancelled', appt.id);
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, outcome, correlation_id)
  values (actor, 'scheduling.appointment_cancelled', 'appointment', appt.id, 'success', gen_random_uuid());
end;
$$;

create or replace function public.close_appointment(p_appointment_id uuid, p_outcome text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  appt public.appointments%rowtype;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('completed', 'no_show') then
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;
  select * into appt from public.appointments where id = p_appointment_id for update;
  if not found or appt.professional_user_id <> actor then
    raise exception 'appointment_not_found' using errcode = 'P0002';
  end if;
  if appt.status <> 'confirmed' then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if appt.starts_at > statement_timestamp() then
    raise exception 'appointment_not_started' using errcode = '22023';
  end if;

  if p_outcome = 'completed' then
    update public.appointments set status = 'completed', completed_at = timezone('utc', now()) where id = appt.id;
  else
    update public.appointments set status = 'no_show', no_show_at = timezone('utc', now()) where id = appt.id;
  end if;
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, outcome, correlation_id)
  values (actor, 'scheduling.appointment_' || p_outcome, 'appointment', appt.id, 'success', gen_random_uuid());
end;
$$;

revoke all on function public.confirm_appointment(uuid) from public, anon, service_role;
revoke all on function public.cancel_appointment(uuid, text) from public, anon, service_role;
revoke all on function public.close_appointment(uuid, text) from public, anon, service_role;
grant execute on function public.confirm_appointment(uuid) to authenticated;
grant execute on function public.cancel_appointment(uuid, text) to authenticated;
grant execute on function public.close_appointment(uuid, text) to authenticated;

/*
  Vinculo revogado ou encerrado: pedidos e horarios futuros caem juntos. Sem
  isto, um horario sobreviveria ao fim do relacionamento que o justificava.
  Pausa NAO cancela (pausar e restringir leitura de dado, nao desmarcar).
*/
create or replace function public.cancel_appointments_on_relationship_end()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('revoked', 'ended') and old.status is distinct from new.status then
    update public.appointments
    set status = 'cancelled', cancelled_at = timezone('utc', now()),
        cancelled_by = null, cancel_reason = 'relationship_ended'
    where connection_id = new.id
      and status in ('requested', 'confirmed')
      and starts_at > statement_timestamp();
  end if;
  return new;
end;
$$;

create trigger professional_connections_cancel_appointments
after update of status on public.professional_connections
for each row execute function public.cancel_appointments_on_relationship_end();

-- ---------------------------------------------------------------------------
-- 10. Leituras com projecao fixa
-- ---------------------------------------------------------------------------

/*
  Os horarios da propria pessoa (nos dois papeis), com o nome do outro
  participante. O nome so sai porque os dois compartilham um vinculo; a pessoa
  nao le `profiles` do profissional por RLS.
*/
create or replace function public.list_my_appointments(p_since timestamptz)
returns table (
  id uuid,
  connection_id uuid,
  role text,
  counterpart_user_id uuid,
  counterpart_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  modality text,
  status text,
  requested_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by_me boolean,
  cancel_reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    appt.id,
    appt.connection_id,
    case when appt.professional_user_id = auth.uid() then 'professional' else 'client' end,
    case when appt.professional_user_id = auth.uid() then appt.client_user_id else appt.professional_user_id end,
    case when appt.professional_user_id = auth.uid()
      then client_profile.display_name
      else coalesce(public_profile.display_name, pro_profile.display_name)
    end,
    appt.starts_at, appt.ends_at, appt.timezone, appt.modality, appt.status,
    appt.requested_at, appt.confirmed_at, appt.cancelled_at,
    appt.cancelled_by = auth.uid(),
    appt.cancel_reason
  from public.appointments appt
  left join public.profiles client_profile on client_profile.user_id = appt.client_user_id
  left join public.profiles pro_profile on pro_profile.user_id = appt.professional_user_id
  left join public.professional_public_profiles public_profile on public_profile.user_id = appt.professional_user_id
  where auth.uid() in (appt.client_user_id, appt.professional_user_id)
    and appt.starts_at >= coalesce(p_since, statement_timestamp() - interval '30 days')
  order by appt.starts_at
  limit 500;
$$;

revoke all on function public.list_my_appointments(timestamptz) from public, anon, service_role;
grant execute on function public.list_my_appointments(timestamptz) to authenticated;

/*
  Com quem a pessoa pode marcar: vinculos ativos, profissional com verificacao
  vigente. Diz se ha regra de disponibilidade, mas nao expoe as regras.
*/
create or replace function public.list_my_scheduling_professionals()
returns table (
  connection_id uuid,
  professional_user_id uuid,
  professional_name text,
  has_availability boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    connection.id,
    connection.professional_user_id,
    coalesce(public_profile.display_name, pro_profile.display_name),
    exists (
      select 1 from public.professional_availability_rules rule
      where rule.professional_user_id = connection.professional_user_id
    )
  from public.professional_connections connection
  left join public.profiles pro_profile on pro_profile.user_id = connection.professional_user_id
  left join public.professional_public_profiles public_profile on public_profile.user_id = connection.professional_user_id
  where connection.client_user_id = auth.uid()
    and connection.status = 'active'
    and public.professional_verification_is_current(connection.professional_user_id)
  order by 3;
$$;

revoke all on function public.list_my_scheduling_professionals() from public, anon, service_role;
grant execute on function public.list_my_scheduling_professionals() to authenticated;

/*
  Disponibilidade factual na descoberta (PRO-5): so "ha horarios nas proximas
  duas semanas", sem grade, sem nomes, sem ocupacao. Mesma elegibilidade do
  diretorio.
*/
create or replace function public.professional_directory_has_availability(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
    from public.professional_public_profiles profile
    join public.professional_availability_rules rule on rule.professional_user_id = profile.user_id
    where profile.slug = p_slug
      and profile.listed
      and public.professional_verification_is_current(profile.user_id)
      and auth.uid() is not null
  ), false);
$$;

revoke all on function public.professional_directory_has_availability(text) from public, anon, service_role;
grant execute on function public.professional_directory_has_availability(text) to authenticated;

/*
  Vinculo ativo de quem pergunta com o profissional daquele perfil publico.
  Serve so para o CTA "Pedir horario" do perfil: devolve o id do vinculo da
  propria pessoa (que ela ja le pela RLS de professional_connections) ou null.
  Nao revela vinculo de terceiros nem o user_id do profissional.
*/
create or replace function public.my_active_connection_for_directory_slug(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select connection.id
  from public.professional_public_profiles profile
  join public.professional_connections connection
    on connection.professional_user_id = profile.user_id
  where profile.slug = p_slug
    and profile.listed
    and public.professional_verification_is_current(profile.user_id)
    and connection.client_user_id = auth.uid()
    and connection.status = 'active'
  limit 1;
$$;

revoke all on function public.my_active_connection_for_directory_slug(text) from public, anon, service_role;
grant execute on function public.my_active_connection_for_directory_slug(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Lembrete 24 h (in-app sob leitura; e-mail pelo dispatcher)
-- ---------------------------------------------------------------------------

create or replace function public.materialize_in_app_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_day date := current_date;
  current_week text := to_char(current_date, 'IYYY-"W"IW');
  created_id uuid;
  created_count integer := 0;
  reminder record;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.user_preferences where user_id = current_user_id
  ) then
    raise exception 'preferences not found' using errcode = 'P0002';
  end if;

  perform public.seed_notification_preferences(current_user_id);

  if public.notification_channel_delivers(current_user_id, 'checkin_reminder', 'in_app')
    and not exists (
      select 1
      from public.emotional_checkins checkin
      where checkin.user_id = current_user_id
        and (checkin.occurred_at at time zone 'UTC')::date = current_day
    ) then
    created_id := null;
    insert into public.notifications (user_id, kind, event_key)
    values (current_user_id, 'checkin_reminder', 'checkin_reminder:' || to_char(current_day, 'YYYY-MM-DD'))
    on conflict (user_id, event_key) do nothing
    returning id into created_id;
    if created_id is not null then
      created_count := created_count + 1;
      insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, outcome, correlation_id)
      values (current_user_id, 'notification.created', 'notification', created_id, 'success', gen_random_uuid());
    end if;
  end if;

  if public.notification_channel_delivers(current_user_id, 'goal_reminder', 'in_app')
    and exists (
      select 1 from public.goals goal
      where goal.user_id = current_user_id and goal.status = 'active'
    ) then
    created_id := null;
    insert into public.notifications (user_id, kind, event_key)
    values (current_user_id, 'goal_reminder', 'goal_reminder:' || to_char(current_day, 'YYYY-MM-DD'))
    on conflict (user_id, event_key) do nothing
    returning id into created_id;
    if created_id is not null then
      created_count := created_count + 1;
      insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, outcome, correlation_id)
      values (current_user_id, 'notification.created', 'notification', created_id, 'success', gen_random_uuid());
    end if;
  end if;

  if public.notification_channel_delivers(current_user_id, 'weekly_digest', 'in_app') then
    created_id := null;
    insert into public.notifications (user_id, kind, event_key)
    values (current_user_id, 'weekly_digest', 'weekly_digest:' || current_week)
    on conflict (user_id, event_key) do nothing
    returning id into created_id;
    if created_id is not null then
      created_count := created_count + 1;
      insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, outcome, correlation_id)
      values (current_user_id, 'notification.created', 'notification', created_id, 'success', gen_random_uuid());
    end if;
  end if;

  -- PRO-6: lembrete de horario confirmado nas proximas 24 h, uma vez por horario.
  if public.notification_channel_delivers(current_user_id, 'appointment_reminder', 'in_app') then
    for reminder in
      select appt.id from public.appointments appt
      where current_user_id in (appt.client_user_id, appt.professional_user_id)
        and appt.status = 'confirmed'
        and appt.starts_at > statement_timestamp()
        and appt.starts_at <= statement_timestamp() + interval '24 hours'
    loop
      created_id := null;
      insert into public.notifications (user_id, kind, event_key)
      values (current_user_id, 'appointment_reminder', 'appointment_reminder:' || reminder.id::text)
      on conflict (user_id, event_key) do nothing
      returning id into created_id;
      if created_id is not null then
        created_count := created_count + 1;
      end if;
    end loop;
  end if;

  return created_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. E-mail de agenda pelo dispatcher da Stage 29-C
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
    'appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder'
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

revoke all on function public.enqueue_notification_email_for(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_notification_email_for(uuid, text, text, text, text, text)
  to service_role;
