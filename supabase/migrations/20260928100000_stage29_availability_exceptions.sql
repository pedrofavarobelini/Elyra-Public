-- ---------------------------------------------------------------------------
-- Stage 29 / UX F6 - Excecoes de agenda (ADR-0029, D-UX-4, D-UX-5).
--
-- Migration **aditiva**. Tabela nova `professional_availability_exceptions`.
-- A regra semanal (`professional_availability_rules`) nao muda: continua sendo
-- a base. As funcoes de oferta sao **substituidas** pela mesma assinatura:
--
--   horarios = (regra semanal  UNIAO  aberturas)  MENOS  bloqueios
--
-- - **Abertura** (`open`): faixa num dia ou num intervalo de dias, com duracao
--   e modalidade proprias. Nao pode se sobrepor a outra abertura nem a uma
--   faixa semanal do mesmo dia (evita duas grades concorrentes).
-- - **Bloqueio** (`block`): dia inteiro (sem faixa) ou faixa, num dia ou num
--   periodo (ferias). Vale para qualquer modalidade.
-- - Bloquear **nao cancela** horario pedido ou confirmado (D-UX-5): o conflito
--   e listado para o profissional decidir. O pedido novo num horario bloqueado
--   e recusado como `slot_not_offered` (a oferta ja nao existe).
-- - Antecedencia minima de 60 min e horizonte de 60 dias continuam iguais
--   (`scheduling_window_ok`, D-UX-4).
-- - Sem texto livre: a excecao nao carrega motivo. Nada clinico cabe aqui.
-- ---------------------------------------------------------------------------

create table if not exists public.professional_availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  professional_user_id uuid not null references public.profiles(user_id) on delete cascade,
  kind text not null check (kind in ('open', 'block')),
  starts_on date not null,
  ends_on date not null,
  -- Faixa local em minutos. As duas nulas = dia inteiro (so para bloqueio).
  start_minute smallint check (start_minute between 0 and 1439),
  end_minute smallint check (end_minute between 1 and 1440),
  slot_minutes smallint check (slot_minutes in (30, 45, 50, 60, 90)),
  modality text check (modality in ('online', 'in_person')),
  timezone text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint availability_exception_dates check (ends_on >= starts_on and ends_on - starts_on <= 366),
  constraint availability_exception_window check (
    (start_minute is null and end_minute is null)
    or (start_minute is not null and end_minute is not null and end_minute > start_minute)
  ),
  constraint availability_exception_shape check (
    (kind = 'open'
      and start_minute is not null
      and slot_minutes is not null
      and modality is not null
      and end_minute - start_minute >= slot_minutes)
    or (kind = 'block' and slot_minutes is null and modality is null)
  ),
  -- Duas aberturas nao se sobrepoem (dias e faixa ao mesmo tempo).
  constraint availability_exception_open_no_overlap exclude using gist (
    professional_user_id with =,
    daterange(starts_on, ends_on, '[]') with &&,
    int4range(start_minute::int, end_minute::int, '[)') with &&
  ) where (kind = 'open')
);

comment on table public.professional_availability_exceptions is
  'Excecoes da agenda semanal (UX F6): aberturas e bloqueios por data ou periodo. Sem motivo em texto livre.';

create index if not exists professional_availability_exceptions_pro_idx
  on public.professional_availability_exceptions (professional_user_id, ends_on);

alter table public.professional_availability_exceptions enable row level security;
alter table public.professional_availability_exceptions force row level security;
revoke all on table public.professional_availability_exceptions from public, anon, authenticated;
grant select on table public.professional_availability_exceptions to authenticated;
grant all on table public.professional_availability_exceptions to service_role;

-- So o dono le as proprias excecoes. Terceiros so veem horarios calculados.
create policy professional_availability_exceptions_select_own
on public.professional_availability_exceptions for select to authenticated
using ((select auth.uid()) = professional_user_id);

-- ---------------------------------------------------------------------------
-- 1. A faixa local [start, end) de algum dia em [starts_on, ends_on] toca o
--    intervalo absoluto [p_from, p_to)? `at time zone` conhece horario de verao.
-- ---------------------------------------------------------------------------

create or replace function public.availability_window_overlaps(
  p_starts_on date,
  p_ends_on date,
  p_start_minute integer,
  p_end_minute integer,
  p_timezone text,
  p_from timestamptz,
  p_to timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from generate_series(
      greatest(p_starts_on, (p_from at time zone p_timezone)::date - 1)::timestamp,
      least(p_ends_on, (p_to at time zone p_timezone)::date)::timestamp,
      interval '1 day'
    ) as d(day)
    where tstzrange(
      (d.day + make_interval(mins => coalesce(p_start_minute, 0))) at time zone p_timezone,
      (d.day + make_interval(mins => coalesce(p_end_minute, 1440))) at time zone p_timezone,
      '[)'
    ) && tstzrange(p_from, p_to, '[)')
  );
$$;

revoke all on function public.availability_window_overlaps(date, date, integer, integer, text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Oferta de um horario: regra semanal OU abertura, e nenhum bloqueio.
--    Mesma assinatura; `request_appointment` herda a regra sem mudar.
-- ---------------------------------------------------------------------------

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
  with offers as (
    select p_starts_at + make_interval(mins => rule.slot_minutes) as offer_end, rule.timezone as offer_tz
    from public.professional_availability_rules rule
    cross join lateral (select (p_starts_at at time zone rule.timezone) as local_ts) local
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
    union all
    select p_starts_at + make_interval(mins => ex.slot_minutes), ex.timezone
    from public.professional_availability_exceptions ex
    cross join lateral (select (p_starts_at at time zone ex.timezone) as local_ts) local
    cross join lateral (
      select (extract(hour from local.local_ts) * 60 + extract(minute from local.local_ts))::int as minute_of_day
    ) m
    where ex.professional_user_id = p_professional_user_id
      and ex.kind = 'open'
      and ex.modality = p_modality
      and local.local_ts::date between ex.starts_on and ex.ends_on
      and extract(second from local.local_ts) = 0
      and m.minute_of_day >= ex.start_minute
      and m.minute_of_day + ex.slot_minutes <= ex.end_minute
      and (m.minute_of_day - ex.start_minute) % ex.slot_minutes = 0
  )
  select o.offer_end, o.offer_tz
  from offers o
  where not exists (
    select 1 from public.professional_availability_exceptions block
    where block.professional_user_id = p_professional_user_id
      and block.kind = 'block'
      and public.availability_window_overlaps(
        block.starts_on, block.ends_on, block.start_minute, block.end_minute, block.timezone,
        p_starts_at, o.offer_end
      )
  )
  limit 1;
$$;

revoke all on function public.professional_slot_offer(uuid, timestamptz, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Horarios livres: candidatos semanais + aberturas; o filtro de oferta ja
--    tira os bloqueios. Mesma assinatura e mesma regra de quem pode ver.
-- ---------------------------------------------------------------------------

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
    select
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
    union
    select
      ((day.day + make_interval(mins => grid.minute)) at time zone ex.timezone),
      ex.slot_minutes,
      ex.modality,
      ex.timezone
    from public.professional_availability_exceptions ex
    cross join days day
    cross join lateral generate_series(
      ex.start_minute::int, (ex.end_minute - ex.slot_minutes)::int, ex.slot_minutes::int
    ) as grid(minute)
    where ex.professional_user_id = p_professional_user_id
      and ex.kind = 'open'
      and day.day between ex.starts_on and ex.ends_on
  )
  select c.slot_start, c.slot_start + make_interval(mins => c.slot_minutes), c.modality, c.timezone
  from candidates c
  where c.slot_start >= greatest(p_from, statement_timestamp() + interval '60 minutes')
    and c.slot_start < p_to
    and c.slot_start <= statement_timestamp() + interval '60 days'
    -- A grade recalculada tem de bater com a oferta (horario de verao + bloqueios).
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
-- 4. "Tem horarios": aberturas futuras contam como agenda publicada.
-- ---------------------------------------------------------------------------

create or replace function public.professional_has_published_availability(p_professional_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.professional_availability_rules rule
    where rule.professional_user_id = p_professional_user_id
  ) or exists (
    select 1 from public.professional_availability_exceptions ex
    where ex.professional_user_id = p_professional_user_id
      and ex.kind = 'open'
      and ex.ends_on >= (statement_timestamp() at time zone ex.timezone)::date
  );
$$;

revoke all on function public.professional_has_published_availability(uuid)
  from public, anon, authenticated, service_role;

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
    public.professional_has_published_availability(connection.professional_user_id)
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
    where profile.slug = p_slug
      and profile.listed
      and public.professional_verification_is_current(profile.user_id)
      and public.professional_has_published_availability(profile.user_id)
      and auth.uid() is not null
  ), false);
$$;

revoke all on function public.professional_directory_has_availability(text) from public, anon, service_role;
grant execute on function public.professional_directory_has_availability(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Salvar e remover uma excecao
-- ---------------------------------------------------------------------------

create or replace function public.save_professional_availability_exception(
  p_timezone text,
  p_exception jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  v_kind text;
  v_starts date;
  v_ends date;
  v_start integer;
  v_end integer;
  v_slot integer;
  v_modality text;
  today date;
  created_id uuid;
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
  if p_exception is null or jsonb_typeof(p_exception) <> 'object'
    or (p_exception - array['kind','starts_on','ends_on','start_minute','end_minute','slot_minutes','modality']) <> '{}'::jsonb then
    raise exception 'invalid_exception' using errcode = '22023';
  end if;

  v_kind := p_exception->>'kind';
  v_starts := (p_exception->>'starts_on')::date;
  v_ends := (p_exception->>'ends_on')::date;
  v_start := (p_exception->>'start_minute')::integer;
  v_end := (p_exception->>'end_minute')::integer;
  v_slot := (p_exception->>'slot_minutes')::integer;
  v_modality := p_exception->>'modality';
  today := (statement_timestamp() at time zone p_timezone)::date;

  if v_kind is null or v_kind not in ('open', 'block')
    or v_starts is null or v_ends is null or v_ends < v_starts or v_starts < today then
    raise exception 'invalid_exception' using errcode = '22023';
  end if;
  -- Abertura so dentro do horizonte de pedido (60 dias); bloqueio ate 1 ano.
  if (v_kind = 'open' and v_ends > today + 60) or (v_kind = 'block' and v_ends > today + 366) then
    raise exception 'exception_outside_window' using errcode = '22023';
  end if;
  if (
    select count(*) from public.professional_availability_exceptions ex
    where ex.professional_user_id = actor and ex.ends_on >= today
  ) >= 60 then
    raise exception 'too_many_exceptions' using errcode = '22023';
  end if;
  if v_kind = 'open' and v_start is not null and v_end is not null and exists (
    select 1
    from public.professional_availability_rules rule
    cross join generate_series(v_starts::timestamp, v_ends::timestamp, interval '1 day') as d(day)
    where rule.professional_user_id = actor
      and rule.weekday = extract(dow from d.day)
      and int4range(rule.start_minute::int, rule.end_minute::int, '[)') && int4range(v_start, v_end, '[)')
  ) then
    raise exception 'exception_overlap' using errcode = '22023';
  end if;

  insert into public.professional_availability_exceptions (
    professional_user_id, kind, starts_on, ends_on, start_minute, end_minute, slot_minutes, modality, timezone
  ) values (
    actor, v_kind, v_starts, v_ends, v_start, v_end, v_slot, v_modality, p_timezone
  )
  returning id into created_id;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, outcome, correlation_id)
  values (actor, 'scheduling.availability_exception_saved', 'availability', created_id, 'success', gen_random_uuid());
  return created_id;
exception
  when exclusion_violation then
    raise exception 'exception_overlap' using errcode = '22023';
  when check_violation or invalid_text_representation or numeric_value_out_of_range or not_null_violation
    or invalid_datetime_format or datetime_field_overflow then
    raise exception 'invalid_exception' using errcode = '22023';
end;
$$;

revoke all on function public.save_professional_availability_exception(text, jsonb) from public, anon, service_role;
grant execute on function public.save_professional_availability_exception(text, jsonb) to authenticated;

create or replace function public.delete_professional_availability_exception(p_exception_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  delete from public.professional_availability_exceptions
  where id = p_exception_id and professional_user_id = actor;
  if not found then
    raise exception 'exception_not_found' using errcode = 'P0002';
  end if;
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, outcome, correlation_id)
  values (actor, 'scheduling.availability_exception_removed', 'availability', p_exception_id, 'success', gen_random_uuid());
end;
$$;

revoke all on function public.delete_professional_availability_exception(uuid) from public, anon, service_role;
grant execute on function public.delete_professional_availability_exception(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Conflitos: horarios pedidos/confirmados que caem num bloqueio (D-UX-5).
--    So leitura; nada e cancelado aqui.
-- ---------------------------------------------------------------------------

create or replace function public.list_my_availability_conflicts()
returns table (
  exception_id uuid,
  appointment_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select block.id, appt.id, appt.starts_at, appt.ends_at, appt.status
  from public.professional_availability_exceptions block
  join public.appointments appt on appt.professional_user_id = block.professional_user_id
  where block.professional_user_id = auth.uid()
    and block.kind = 'block'
    and appt.status in ('requested', 'confirmed')
    and appt.ends_at > statement_timestamp()
    and public.availability_window_overlaps(
      block.starts_on, block.ends_on, block.start_minute, block.end_minute, block.timezone,
      appt.starts_at, appt.ends_at
    )
  order by appt.starts_at, block.id;
$$;

revoke all on function public.list_my_availability_conflicts() from public, anon, service_role;
grant execute on function public.list_my_availability_conflicts() to authenticated;
