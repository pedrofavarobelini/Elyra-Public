-- Stage 05: nucleo emocional persistente. Migration estritamente aditiva.

create table public.emotional_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  occurred_at timestamptz not null default timezone('utc', now()),
  mood_score smallint check (mood_score between 0 and 10),
  perceived_anxiety_score smallint check (perceived_anxiety_score between 0 and 10),
  energy_score smallint check (energy_score between 0 and 10),
  primary_feeling text check (
    primary_feeling in ('feliz', 'tranquilo', 'neutro', 'triste', 'ansioso')
  ),
  note text check (note is null or char_length(note) between 1 and 500),
  created_at timestamptz not null default timezone('utc', now()),
  constraint emotional_checkin_has_value check (
    mood_score is not null
    or perceived_anxiety_score is not null
    or energy_score is not null
    or primary_feeling is not null
  )
);

create index emotional_checkins_user_time_idx
  on public.emotional_checkins (user_id, occurred_at desc);

create or replace function public.reject_future_emotional_checkin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.occurred_at > statement_timestamp() then
    raise exception 'future emotional check-in is not allowed'
      using errcode = '22007';
  end if;
  return new;
end;
$$;

create trigger emotional_checkins_reject_future
before insert or update on public.emotional_checkins
for each row execute function public.reject_future_emotional_checkin();

create table public.emotional_factors (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) between 1 and 40),
  origin text not null check (origin in ('system', 'custom')),
  owner_user_id uuid references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  constraint emotional_factor_owner_shape check (
    (origin = 'system' and owner_user_id is null)
    or (origin = 'custom' and owner_user_id is not null)
  )
);

create unique index emotional_factors_system_label_idx
  on public.emotional_factors (lower(label))
  where origin = 'system';
create unique index emotional_factors_owner_label_idx
  on public.emotional_factors (owner_user_id, lower(label))
  where origin = 'custom';
create index emotional_factors_owner_idx
  on public.emotional_factors (owner_user_id)
  where owner_user_id is not null;

insert into public.emotional_factors (id, label, origin, owner_user_id)
values
  ('10000000-0000-4000-8000-000000000001', 'Trabalho', 'system', null),
  ('10000000-0000-4000-8000-000000000002', 'Estudos', 'system', null),
  ('10000000-0000-4000-8000-000000000003', 'Sono', 'system', null),
  ('10000000-0000-4000-8000-000000000004', 'Exercicio', 'system', null),
  ('10000000-0000-4000-8000-000000000005', 'Familia', 'system', null),
  ('10000000-0000-4000-8000-000000000006', 'Saude', 'system', null),
  ('10000000-0000-4000-8000-000000000007', 'Financas', 'system', null),
  ('10000000-0000-4000-8000-000000000008', 'Vida social', 'system', null);

create table public.emotional_checkin_factors (
  checkin_id uuid not null references public.emotional_checkins(id) on delete cascade,
  factor_id uuid not null references public.emotional_factors(id) on delete restrict,
  primary key (checkin_id, factor_id)
);

create table public.sleep_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  night date not null,
  duration_minutes smallint check (duration_minutes between 0 and 1440),
  sleep_quality_score smallint check (sleep_quality_score between 0 and 10),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint sleep_record_has_value check (
    duration_minutes is not null or sleep_quality_score is not null
  ),
  constraint sleep_record_user_night_unique unique (user_id, night)
);

create trigger sleep_records_set_updated_at
before update on public.sleep_records
for each row execute function public.set_updated_at();

create or replace function public.audit_emotional_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  action_name text;
  entity_name text;
begin
  -- Escritas administrativas de seed/QA nao fingem ser acao do usuario.
  if actor_id is null then
    return new;
  end if;

  action_name := case tg_table_name
    when 'emotional_checkins' then 'emotional_checkin.created'
    when 'emotional_factors' then 'emotional_factor.created'
    when 'sleep_records' then
      case when tg_op = 'INSERT' then 'sleep_record.created' else 'sleep_record.updated' end
  end;
  entity_name := case tg_table_name
    when 'emotional_checkins' then 'emotional_checkin'
    when 'emotional_factors' then 'emotional_factor'
    when 'sleep_records' then 'sleep_record'
  end;

  insert into public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    outcome,
    correlation_id
  )
  values (actor_id, action_name, entity_name, new.id, 'success', gen_random_uuid());

  return new;
end;
$$;

create trigger emotional_checkins_audit_insert
after insert on public.emotional_checkins
for each row execute function public.audit_emotional_write();
create trigger emotional_factors_audit_insert
after insert on public.emotional_factors
for each row execute function public.audit_emotional_write();
create trigger sleep_records_audit_write
after insert or update on public.sleep_records
for each row execute function public.audit_emotional_write();

alter table public.emotional_checkins enable row level security;
alter table public.emotional_checkins force row level security;
alter table public.emotional_factors enable row level security;
alter table public.emotional_factors force row level security;
alter table public.emotional_checkin_factors enable row level security;
alter table public.emotional_checkin_factors force row level security;
alter table public.sleep_records enable row level security;
alter table public.sleep_records force row level security;

revoke all on table public.emotional_checkins from anon, authenticated;
revoke all on table public.emotional_factors from anon, authenticated;
revoke all on table public.emotional_checkin_factors from anon, authenticated;
revoke all on table public.sleep_records from anon, authenticated;

grant select, insert on table public.emotional_checkins to authenticated;
grant select, insert on table public.emotional_factors to authenticated;
grant select, insert on table public.emotional_checkin_factors to authenticated;
grant select, insert, update on table public.sleep_records to authenticated;
grant all on table public.emotional_checkins to service_role;
grant all on table public.emotional_factors to service_role;
grant all on table public.emotional_checkin_factors to service_role;
grant all on table public.sleep_records to service_role;

create policy emotional_checkins_select_own
on public.emotional_checkins for select to authenticated
using ((select auth.uid()) = user_id);
create policy emotional_checkins_insert_own
on public.emotional_checkins for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy emotional_factors_select_visible
on public.emotional_factors for select to authenticated
using (origin = 'system' or (select auth.uid()) = owner_user_id);
create policy emotional_factors_insert_custom_own
on public.emotional_factors for insert to authenticated
with check (origin = 'custom' and (select auth.uid()) = owner_user_id);

create policy emotional_checkin_factors_select_own
on public.emotional_checkin_factors for select to authenticated
using (
  exists (
    select 1
    from public.emotional_checkins checkin
    where checkin.id = checkin_id
      and checkin.user_id = (select auth.uid())
  )
);
create policy emotional_checkin_factors_insert_own_visible
on public.emotional_checkin_factors for insert to authenticated
with check (
  exists (
    select 1
    from public.emotional_checkins checkin
    where checkin.id = checkin_id
      and checkin.user_id = (select auth.uid())
  )
  and exists (
    select 1
    from public.emotional_factors factor
    where factor.id = factor_id
      and (factor.origin = 'system' or factor.owner_user_id = (select auth.uid()))
  )
);

create policy sleep_records_select_own
on public.sleep_records for select to authenticated
using ((select auth.uid()) = user_id);
create policy sleep_records_insert_own
on public.sleep_records for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy sleep_records_update_own
on public.sleep_records for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create or replace function public.create_emotional_checkin(p_payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_id uuid;
begin
  if jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(coalesce(p_payload -> 'factor_ids', '[]'::jsonb)) <> 'array' then
    raise exception 'invalid emotional check-in payload'
      using errcode = '22023';
  end if;

  insert into public.emotional_checkins (
    user_id,
    occurred_at,
    mood_score,
    perceived_anxiety_score,
    energy_score,
    primary_feeling,
    note
  )
  values (
    (select auth.uid()),
    (p_payload ->> 'occurred_at')::timestamptz,
    (p_payload ->> 'mood_score')::smallint,
    (p_payload ->> 'perceived_anxiety_score')::smallint,
    (p_payload ->> 'energy_score')::smallint,
    p_payload ->> 'primary_feeling',
    nullif(btrim(p_payload ->> 'note'), '')
  )
  returning id into created_id;

  insert into public.emotional_checkin_factors (checkin_id, factor_id)
  select created_id, selected.factor_id::uuid
  from (
    select distinct jsonb_array_elements_text(
      coalesce(p_payload -> 'factor_ids', '[]'::jsonb)
    ) as factor_id
  ) selected;

  return created_id;
end;
$$;

revoke all on function public.create_emotional_checkin(jsonb) from public;
grant execute on function public.create_emotional_checkin(jsonb)
to authenticated, service_role;
