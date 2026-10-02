-- ADR-0035: finite dates are the sole offer source. Additive schema;
-- recurring rows and appointments are preserved. No remote execution here.
create table public.professional_availability_weeks (
  professional_user_id uuid not null references public.profiles(user_id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  timezone text not null,
  published_at timestamptz not null default now(),
  primary key (professional_user_id, week_start)
);
alter table public.professional_availability_weeks enable row level security;
alter table public.professional_availability_weeks force row level security;
revoke all on public.professional_availability_weeks from public, anon, authenticated;
grant select on public.professional_availability_weeks to authenticated;
grant all on public.professional_availability_weeks to service_role;
create policy availability_weeks_select_own on public.professional_availability_weeks
for select to authenticated using ((select auth.uid()) = professional_user_id);
comment on table public.professional_availability_weeks is
  'Finite publication metadata, including empty weeks. Intervals remain in availability_exceptions.';
comment on table public.professional_availability_rules is
  'Legacy inactive templates (ADR-0035). Never a source of offered slots; rows retained.';

create or replace function public.professional_slot_offer(
  p_professional_user_id uuid, p_starts_at timestamptz, p_modality text
)
returns table (ends_at timestamptz, timezone text)
language sql stable security definer set search_path = '' as $$
  select p_starts_at + make_interval(mins => ex.slot_minutes), ex.timezone
  from public.professional_availability_exceptions ex
  cross join lateral (select p_starts_at at time zone ex.timezone as ts) local
  cross join lateral (select (extract(hour from local.ts)*60 + extract(minute from local.ts))::int as minute) m
  where ex.professional_user_id = p_professional_user_id and ex.kind = 'open'
    and ex.modality = p_modality and local.ts::date between ex.starts_on and ex.ends_on
    and extract(second from local.ts) = 0 and m.minute >= ex.start_minute
    and m.minute + ex.slot_minutes <= ex.end_minute
    and (m.minute - ex.start_minute) % ex.slot_minutes = 0
    -- Canonical civil->instant round trip: no phantom spring gap/duplicate fold.
    and (local.ts::date + make_interval(mins => m.minute)) at time zone ex.timezone = p_starts_at
    and p_starts_at + make_interval(mins => ex.slot_minutes)
      <= (local.ts::date + make_interval(mins => ex.end_minute)) at time zone ex.timezone
    and not exists (
      select 1 from public.professional_availability_exceptions block
      where block.professional_user_id = p_professional_user_id and block.kind = 'block'
        and public.availability_window_overlaps(block.starts_on, block.ends_on,
          block.start_minute, block.end_minute, block.timezone,
          p_starts_at, p_starts_at + make_interval(mins => ex.slot_minutes))
    )
  limit 1;
$$;
revoke all on function public.professional_slot_offer(uuid, timestamptz, text)
from public, anon, authenticated, service_role;

create or replace function public.professional_has_published_availability(p_professional_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.professional_availability_exceptions ex
    where ex.professional_user_id = p_professional_user_id and ex.kind = 'open'
      and ex.ends_on >= (statement_timestamp() at time zone ex.timezone)::date);
$$;
revoke all on function public.professional_has_published_availability(uuid)
from public, anon, authenticated, service_role;

create function public.get_professional_availability_week(p_week_start date, p_timezone text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); tz text; published boolean; intervals jsonb; blocks jsonb;
  slots jsonb; conflicts jsonb; content jsonb;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not public.professional_verification_is_current(actor) then
    raise exception 'verification_required' using errcode='42501'; end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'invalid_week' using errcode='22023'; end if;
  if not public.scheduling_timezone_is_valid(p_timezone) then
    raise exception 'invalid_timezone' using errcode='22023'; end if;
  select w.timezone into tz from public.professional_availability_weeks w
    where w.professional_user_id=actor and w.week_start=p_week_start;
  published := found;
  if tz is null then
    select ex.timezone into tz from public.professional_availability_exceptions ex
      where ex.professional_user_id=actor and ex.starts_on<=p_week_start+6 and ex.ends_on>=p_week_start
      order by ex.created_at limit 1;
  end if;
  tz := coalesce(tz, p_timezone);
  if exists(select 1 from public.professional_availability_exceptions ex
    where ex.professional_user_id=actor and ex.starts_on<=p_week_start+6 and ex.ends_on>=p_week_start
      and ex.timezone<>tz) then
    -- Never silently reinterpret legacy publications that used mixed zones.
    raise exception 'timezone_conflict' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('date',d.day::date,'startMinute',ex.start_minute,
    'endMinute',ex.end_minute,'slotMinutes',ex.slot_minutes,'modality',ex.modality)
    order by d.day,ex.start_minute,ex.end_minute,ex.modality),'[]'::jsonb) into intervals
  from public.professional_availability_exceptions ex
  cross join lateral generate_series(greatest(ex.starts_on,p_week_start)::timestamp,
    least(ex.ends_on,p_week_start+6)::timestamp,interval '1 day') d(day)
  where ex.professional_user_id=actor and ex.kind='open';
  select coalesce(jsonb_agg(jsonb_build_object('date',d.day::date,'startMinute',ex.start_minute,
    'endMinute',ex.end_minute) order by d.day,ex.start_minute nulls first,ex.end_minute nulls first),'[]'::jsonb) into blocks
  from public.professional_availability_exceptions ex
  cross join lateral generate_series(greatest(ex.starts_on,p_week_start)::timestamp,
    least(ex.ends_on,p_week_start+6)::timestamp,interval '1 day') d(day)
  where ex.professional_user_id=actor and ex.kind='block';
  published := published or jsonb_array_length(intervals)>0;
  content := jsonb_build_object('timezone',tz,'intervals',intervals,'blocks',blocks,'published',published);
  select coalesce(jsonb_agg(jsonb_build_object('startsAt',s.starts_at,'endsAt',s.ends_at,
    'modality',s.modality,'timezone',s.timezone) order by s.starts_at,s.modality),'[]'::jsonb) into slots
  from public.list_professional_open_slots(actor,p_week_start::timestamp at time zone tz,
    (p_week_start+7)::timestamp at time zone tz) s;
  select coalesce(jsonb_agg(jsonb_build_object('appointmentId',a.id,'startsAt',a.starts_at,
    'endsAt',a.ends_at,'status',a.status) order by a.starts_at),'[]'::jsonb) into conflicts
  from public.appointments a where a.professional_user_id=actor and a.status in ('requested','confirmed')
    and a.ends_at>statement_timestamp() and (a.starts_at at time zone a.timezone)::date between p_week_start and p_week_start+6
    and not exists(select 1 from public.professional_slot_offer(actor,a.starts_at,a.modality) offer where offer.ends_at=a.ends_at);
  return content || jsonb_build_object('weekStart',p_week_start,'revision',md5(content::text),'slots',slots,'conflicts',conflicts);
end;
$$;
revoke all on function public.get_professional_availability_week(date,text) from public,anon,service_role;
grant execute on function public.get_professional_availability_week(date,text) to authenticated;

create function public.save_professional_week_availability(
  p_week_start date, p_timezone text, p_intervals jsonb, p_blocks jsonb, p_expected_revision text
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); today date; cutoff date; upper_day date; snapshot jsonb; canonical jsonb;
  intervals jsonb; blocks jsonb; item jsonb; v_date date; v_start int; v_end int;
  v_slot int; v_modality text; old public.professional_availability_exceptions%rowtype;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not public.professional_verification_is_current(actor) then
    raise exception 'verification_required' using errcode='42501'; end if;
  if not public.scheduling_timezone_is_valid(p_timezone) then
    raise exception 'invalid_timezone' using errcode='22023'; end if;
  today := (statement_timestamp() at time zone p_timezone)::date;
  if p_week_start is null or extract(isodow from p_week_start)<>1 or p_week_start+6<today or p_week_start>today+60
    or p_expected_revision is null or p_expected_revision !~ '^[0-9a-f]{32}$'
    or p_intervals is null or jsonb_typeof(p_intervals)<>'array' or jsonb_array_length(p_intervals)>28
    or p_blocks is null or jsonb_typeof(p_blocks)<>'array' or jsonb_array_length(p_blocks)>28 then
    raise exception 'invalid_week' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(p_intervals) loop
    if jsonb_typeof(item)<>'object' or (item-array['date','start_minute','end_minute','slot_minutes','modality'])<>'{}'::jsonb
      or coalesce(item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'invalid_week' using errcode='22023'; end if;
    v_date := (item->>'date')::date; v_start:=(item->>'start_minute')::int;
    v_end:=(item->>'end_minute')::int; v_slot:=(item->>'slot_minutes')::int; v_modality:=item->>'modality';
    if v_date not between p_week_start and p_week_start+6
      or v_start is null or v_start not between 0 and 1439 or v_end is null or v_end not between 1 and 1440
      or v_slot is null or v_slot not in (30,45,50,60,90) or v_end-v_start<v_slot
      or v_modality is null or v_modality not in ('online','in_person') then
      raise exception 'invalid_week' using errcode='22023'; end if;
  end loop;
  for item in select value from jsonb_array_elements(p_blocks) loop
    if jsonb_typeof(item)<>'object' or not(item ?& array['date','start_minute','end_minute'])
      or (item-array['date','start_minute','end_minute'])<>'{}'::jsonb
      or coalesce(item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'invalid_week' using errcode='22023'; end if;
    v_date:=(item->>'date')::date; v_start:=(item->>'start_minute')::int; v_end:=(item->>'end_minute')::int;
    if v_date not between p_week_start and p_week_start+6
      or (v_start is null)<>(v_end is null)
      or (v_start is not null and (v_start not between 0 and 1439 or v_end not between 1 and 1440 or v_end<=v_start)) then
      raise exception 'invalid_week' using errcode='22023'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_intervals) with ordinality a(value,n)
    join jsonb_array_elements(p_intervals) with ordinality b(value,n) on a.n<b.n
    where a.value->>'date'=b.value->>'date' and (a.value->>'start_minute')::int<(b.value->>'end_minute')::int
      and (b.value->>'start_minute')::int<(a.value->>'end_minute')::int) then
    raise exception 'overlapping_rules' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('availability:'||actor::text,0));
  snapshot := public.get_professional_availability_week(p_week_start,p_timezone);
  select coalesce(jsonb_agg(jsonb_build_object('date',x.date,'startMinute',x.start_minute,'endMinute',x.end_minute,
    'slotMinutes',x.slot_minutes,'modality',x.modality) order by x.date,x.start_minute,x.end_minute,x.modality),'[]'::jsonb)
    into intervals from jsonb_to_recordset(p_intervals) x(date date,start_minute int,end_minute int,slot_minutes int,modality text);
  select coalesce(jsonb_agg(jsonb_build_object('date',x.date,'startMinute',x.start_minute,'endMinute',x.end_minute)
    order by x.date,x.start_minute nulls first,x.end_minute nulls first),'[]'::jsonb)
    into blocks from jsonb_to_recordset(p_blocks) x(date date,start_minute int,end_minute int);
  canonical := jsonb_build_object('timezone',p_timezone,'intervals',intervals,'blocks',blocks,'published',true);
  -- Exact replay does not create rows/audit events, even if its old revision was superseded by this identical save.
  if canonical = snapshot-array['weekStart','revision','slots','conflicts'] then return snapshot; end if;
  if snapshot->>'revision'<>p_expected_revision then raise exception 'week_changed' using errcode='40001'; end if;
  -- Read-only calendar dates retain their values and original creation timestamps.
  if (select coalesce(jsonb_agg(v order by v::text),'[]'::jsonb) from jsonb_array_elements(intervals) v where (v->>'date')::date<today)
    <> (select coalesce(jsonb_agg(v order by v::text),'[]'::jsonb) from jsonb_array_elements(snapshot->'intervals') v where (v->>'date')::date<today)
    or (select coalesce(jsonb_agg(v order by v::text),'[]'::jsonb) from jsonb_array_elements(blocks) v where (v->>'date')::date<today)
    <> (select coalesce(jsonb_agg(v order by v::text),'[]'::jsonb) from jsonb_array_elements(snapshot->'blocks') v where (v->>'date')::date<today) then
    raise exception 'past_availability_readonly' using errcode='22023'; end if;
  if (select coalesce(jsonb_agg(v order by v::text),'[]'::jsonb) from jsonb_array_elements(intervals) v where (v->>'date')::date>today+60)
    <> (select coalesce(jsonb_agg(v order by v::text),'[]'::jsonb) from jsonb_array_elements(snapshot->'intervals') v where (v->>'date')::date>today+60)
    or (select coalesce(jsonb_agg(v order by v::text),'[]'::jsonb) from jsonb_array_elements(blocks) v where (v->>'date')::date>today+60)
    <> (select coalesce(jsonb_agg(v order by v::text),'[]'::jsonb) from jsonb_array_elements(snapshot->'blocks') v where (v->>'date')::date>today+60) then
    raise exception 'invalid_week' using errcode='22023'; end if;
  cutoff := greatest(today,p_week_start);
  upper_day := least(p_week_start+6,today+60);
  if exists(select 1 from public.professional_availability_exceptions ex where ex.professional_user_id=actor
    and ex.ends_on>=today and ex.timezone<>p_timezone and (ex.starts_on<cutoff or ex.ends_on>upper_day)) then
    raise exception 'timezone_conflict' using errcode='22023'; end if;
  -- Split crossing finite ranges; all changes roll back together on any error.
  for old in select * from public.professional_availability_exceptions ex
    where ex.professional_user_id=actor and ex.starts_on<=upper_day and ex.ends_on>=cutoff for update loop
    delete from public.professional_availability_exceptions where id=old.id;
    if old.starts_on<cutoff then
      insert into public.professional_availability_exceptions(professional_user_id,kind,starts_on,ends_on,start_minute,end_minute,slot_minutes,modality,timezone,created_at)
      values(actor,old.kind,old.starts_on,cutoff-1,old.start_minute,old.end_minute,old.slot_minutes,old.modality,old.timezone,old.created_at);
    end if;
    if old.ends_on>upper_day then
      insert into public.professional_availability_exceptions(professional_user_id,kind,starts_on,ends_on,start_minute,end_minute,slot_minutes,modality,timezone,created_at)
      values(actor,old.kind,upper_day+1,old.ends_on,old.start_minute,old.end_minute,old.slot_minutes,old.modality,old.timezone,old.created_at);
    end if;
  end loop;
  insert into public.professional_availability_exceptions(professional_user_id,kind,starts_on,ends_on,start_minute,end_minute,slot_minutes,modality,timezone)
  select actor,'open',x.date,x.date,x.start_minute,x.end_minute,x.slot_minutes,x.modality,p_timezone
  from jsonb_to_recordset(p_intervals) x(date date,start_minute int,end_minute int,slot_minutes int,modality text) where x.date between cutoff and upper_day;
  insert into public.professional_availability_exceptions(professional_user_id,kind,starts_on,ends_on,start_minute,end_minute,timezone)
  select actor,'block',x.date,x.date,x.start_minute,x.end_minute,p_timezone
  from jsonb_to_recordset(p_blocks) x(date date,start_minute int,end_minute int) where x.date between cutoff and upper_day;
  insert into public.professional_availability_weeks(professional_user_id,week_start,timezone)
  values(actor,p_week_start,p_timezone) on conflict(professional_user_id,week_start)
  do update set timezone=excluded.timezone,published_at=statement_timestamp();
  insert into public.audit_logs(actor_user_id,action,entity_type,outcome,correlation_id)
  values(actor,'scheduling.week_published','availability','success',gen_random_uuid());
  return public.get_professional_availability_week(p_week_start,p_timezone);
exception
  when exclusion_violation then raise exception 'overlapping_rules' using errcode='22023';
  when check_violation or invalid_text_representation or numeric_value_out_of_range or not_null_violation
    or invalid_datetime_format or datetime_field_overflow then raise exception 'invalid_week' using errcode='22023';
end;
$$;
revoke all on function public.save_professional_week_availability(date,text,jsonb,jsonb,text) from public,anon,service_role;
grant execute on function public.save_professional_week_availability(date,text,jsonb,jsonb,text) to authenticated;

create function public.list_professional_week_slots(p_professional_user_id uuid,p_week_start date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tz text; slots jsonb;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_week_start is null or extract(isodow from p_week_start)<>1 then raise exception 'invalid_week' using errcode='22023'; end if;
  if not public.professional_verification_is_current(p_professional_user_id)
    or (actor<>p_professional_user_id and not exists(select 1 from public.professional_connections c
      where c.client_user_id=actor and c.professional_user_id=p_professional_user_id and c.status='active')) then
    return jsonb_build_object('timezone','America/Sao_Paulo','slots','[]'::jsonb); end if;
  select ex.timezone into tz from public.professional_availability_exceptions ex
    where ex.professional_user_id=p_professional_user_id and ex.ends_on>=(statement_timestamp() at time zone ex.timezone)::date
    order by ex.starts_on limit 1;
  if tz is null then select w.timezone into tz from public.professional_availability_weeks w
    where w.professional_user_id=p_professional_user_id order by w.week_start desc limit 1; end if;
  tz:=coalesce(tz,'America/Sao_Paulo');
  select coalesce(jsonb_agg(jsonb_build_object('startsAt',s.starts_at,'endsAt',s.ends_at,'modality',s.modality,'timezone',s.timezone)
    order by s.starts_at,s.modality),'[]'::jsonb) into slots
  from public.list_professional_open_slots(p_professional_user_id,p_week_start::timestamp at time zone tz,(p_week_start+7)::timestamp at time zone tz) s;
  return jsonb_build_object('timezone',tz,'slots',slots);
end;
$$;
revoke all on function public.list_professional_week_slots(uuid,date) from public,anon,service_role;
grant execute on function public.list_professional_week_slots(uuid,date) to authenticated;


-- Replace offer generation; old recurring functions remain template-only.
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
      ((day.day + make_interval(mins => grid.minute)) at time zone ex.timezone) as slot_start,
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
  select distinct c.slot_start, c.slot_start + make_interval(mins => c.slot_minutes), c.modality, c.timezone
  from candidates c
  where c.slot_start >= greatest(p_from, statement_timestamp() + interval '60 minutes')
    and c.slot_start < p_to
    and c.slot_start <= statement_timestamp() + interval '60 days'
    -- A grade recalculada tem de bater com a oferta (horario de verao + bloqueios).
    and exists (select 1 from public.professional_slot_offer(p_professional_user_id, c.slot_start, c.modality) offer where offer.ends_at = c.slot_start + make_interval(mins => c.slot_minutes))
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
revoke all on function public.list_professional_open_slots(uuid,timestamptz,timestamptz) from public,anon,service_role;
grant execute on function public.list_professional_open_slots(uuid,timestamptz,timestamptz) to authenticated;

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
  -- ADR-0035: recurring rules are inactive templates, never overlap sources.
  perform pg_advisory_xact_lock(hashtextextended('availability:'||actor::text,0));

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
revoke all on function public.save_professional_availability_exception(text,jsonb) from public,anon,service_role;
grant execute on function public.save_professional_availability_exception(text,jsonb) to authenticated;

-- Legacy per-date deletion shares the weekly writer lock. This prevents a
-- compatibility endpoint from racing a weekly revision check and replacement.
create or replace function public.delete_professional_availability_exception(p_exception_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('availability:'||actor::text,0));
  delete from public.professional_availability_exceptions where id=p_exception_id and professional_user_id=actor;
  if not found then raise exception 'exception_not_found' using errcode='P0002'; end if;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,outcome,correlation_id)
  values(actor,'scheduling.availability_exception_removed','availability',p_exception_id,'success',gen_random_uuid());
end;
$$;
revoke all on function public.delete_professional_availability_exception(uuid) from public,anon,service_role;
grant execute on function public.delete_professional_availability_exception(uuid) to authenticated;
