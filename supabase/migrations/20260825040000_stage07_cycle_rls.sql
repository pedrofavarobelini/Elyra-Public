-- Stage 07: ciclo menstrual persistente, privado e opt-in.
-- Migration aditiva. Fases e previsoes continuam derivadas na aplicacao.

create table public.cycle_profiles (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  enabled boolean not null default false,
  opted_in_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint cycle_profile_optin_shape check (
    not enabled or opted_in_at is not null
  )
);

create trigger cycle_profiles_set_updated_at
before update on public.cycle_profiles
for each row execute function public.set_updated_at();

create table public.cycle_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.cycle_profiles(user_id) on delete cascade,
  start_date date not null,
  end_date date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint cycle_period_end_after_start check (
    end_date is null or end_date >= start_date
  ),
  constraint cycle_period_user_start_unique unique (user_id, start_date)
);

create index cycle_periods_user_start_idx
  on public.cycle_periods (user_id, start_date desc);

create trigger cycle_periods_set_updated_at
before update on public.cycle_periods
for each row execute function public.set_updated_at();

create table public.cycle_daily_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.cycle_profiles(user_id) on delete cascade,
  record_date date not null,
  flow text check (flow is null or flow in ('spotting', 'light', 'medium', 'heavy')),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint cycle_daily_user_date_unique unique (user_id, record_date)
);

create index cycle_daily_records_user_date_idx
  on public.cycle_daily_records (user_id, record_date desc);

create trigger cycle_daily_records_set_updated_at
before update on public.cycle_daily_records
for each row execute function public.set_updated_at();

create table public.cycle_symptoms (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) between 1 and 40),
  origin text not null check (origin in ('system', 'custom')),
  owner_user_id uuid references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  constraint cycle_symptom_owner_shape check (
    (origin = 'system' and owner_user_id is null)
    or (origin = 'custom' and owner_user_id is not null)
  )
);

create unique index cycle_symptoms_system_label_idx
  on public.cycle_symptoms (lower(label)) where origin = 'system';
create unique index cycle_symptoms_owner_label_idx
  on public.cycle_symptoms (owner_user_id, lower(label)) where origin = 'custom';

insert into public.cycle_symptoms (id, label, origin, owner_user_id)
values
  ('30000000-0000-4000-8000-000000000001', 'Colica', 'system', null),
  ('30000000-0000-4000-8000-000000000002', 'Dor de cabeca', 'system', null),
  ('30000000-0000-4000-8000-000000000003', 'Sensibilidade', 'system', null),
  ('30000000-0000-4000-8000-000000000004', 'Cansaco', 'system', null),
  ('30000000-0000-4000-8000-000000000005', 'Inchaco', 'system', null),
  ('30000000-0000-4000-8000-000000000006', 'Alteracao de apetite', 'system', null);

create table public.cycle_daily_symptoms (
  record_id uuid not null references public.cycle_daily_records(id) on delete cascade,
  symptom_id uuid not null references public.cycle_symptoms(id) on delete restrict,
  severity text not null check (severity in ('leve', 'moderada', 'intensa')),
  primary key (record_id, symptom_id)
);

alter table public.cycle_profiles enable row level security;
alter table public.cycle_profiles force row level security;
alter table public.cycle_periods enable row level security;
alter table public.cycle_periods force row level security;
alter table public.cycle_daily_records enable row level security;
alter table public.cycle_daily_records force row level security;
alter table public.cycle_symptoms enable row level security;
alter table public.cycle_symptoms force row level security;
alter table public.cycle_daily_symptoms enable row level security;
alter table public.cycle_daily_symptoms force row level security;

revoke all on table public.cycle_profiles from anon, authenticated;
revoke all on table public.cycle_periods from anon, authenticated;
revoke all on table public.cycle_daily_records from anon, authenticated;
revoke all on table public.cycle_symptoms from anon, authenticated;
revoke all on table public.cycle_daily_symptoms from anon, authenticated;

grant select on table public.cycle_profiles to authenticated;
grant select, insert, update, delete on table public.cycle_periods to authenticated;
grant select, insert, update, delete on table public.cycle_daily_records to authenticated;
grant select, insert, delete on table public.cycle_symptoms to authenticated;
grant select, insert, delete on table public.cycle_daily_symptoms to authenticated;
grant all on table public.cycle_profiles to service_role;
grant all on table public.cycle_periods to service_role;
grant all on table public.cycle_daily_records to service_role;
grant all on table public.cycle_symptoms to service_role;
grant all on table public.cycle_daily_symptoms to service_role;

create policy cycle_profiles_select_own
on public.cycle_profiles for select to authenticated
using ((select auth.uid()) = user_id);

create policy cycle_periods_select_own
on public.cycle_periods for select to authenticated
using ((select auth.uid()) = user_id);
create policy cycle_periods_insert_own
on public.cycle_periods for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.cycle_profiles profile
    where profile.user_id = (select auth.uid()) and profile.enabled
  )
);
create policy cycle_periods_update_own
on public.cycle_periods for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.cycle_profiles profile
    where profile.user_id = (select auth.uid()) and profile.enabled
  )
);
create policy cycle_periods_delete_own
on public.cycle_periods for delete to authenticated
using ((select auth.uid()) = user_id);

create policy cycle_daily_records_select_own
on public.cycle_daily_records for select to authenticated
using ((select auth.uid()) = user_id);
create policy cycle_daily_records_insert_own
on public.cycle_daily_records for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.cycle_profiles profile
    where profile.user_id = (select auth.uid()) and profile.enabled
  )
);
create policy cycle_daily_records_update_own
on public.cycle_daily_records for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.cycle_profiles profile
    where profile.user_id = (select auth.uid()) and profile.enabled
  )
);
create policy cycle_daily_records_delete_own
on public.cycle_daily_records for delete to authenticated
using ((select auth.uid()) = user_id);

create policy cycle_symptoms_select_visible
on public.cycle_symptoms for select to authenticated
using (origin = 'system' or owner_user_id = (select auth.uid()));
create policy cycle_symptoms_insert_custom_own
on public.cycle_symptoms for insert to authenticated
with check (
  origin = 'custom'
  and owner_user_id = (select auth.uid())
  and exists (
    select 1 from public.cycle_profiles profile
    where profile.user_id = (select auth.uid()) and profile.enabled
  )
);
create policy cycle_symptoms_delete_custom_own
on public.cycle_symptoms for delete to authenticated
using (origin = 'custom' and owner_user_id = (select auth.uid()));

create policy cycle_daily_symptoms_select_own
on public.cycle_daily_symptoms for select to authenticated
using (
  exists (
    select 1 from public.cycle_daily_records record
    where record.id = record_id and record.user_id = (select auth.uid())
  )
);
create policy cycle_daily_symptoms_insert_own_visible
on public.cycle_daily_symptoms for insert to authenticated
with check (
  exists (
    select 1 from public.cycle_daily_records record
    where record.id = record_id and record.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.cycle_profiles profile
    where profile.user_id = (select auth.uid()) and profile.enabled
  )
  and exists (
    select 1 from public.cycle_symptoms symptom
    where symptom.id = symptom_id
      and (symptom.origin = 'system' or symptom.owner_user_id = (select auth.uid()))
  )
);
create policy cycle_daily_symptoms_delete_own
on public.cycle_daily_symptoms for delete to authenticated
using (
  exists (
    select 1 from public.cycle_daily_records record
    where record.id = record_id and record.user_id = (select auth.uid())
  )
);

create or replace function public.set_cycle_enabled(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  current_profile public.cycle_profiles%rowtype;
  grant_event public.consent_events%rowtype;
  event_time timestamptz;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  insert into public.cycle_profiles (user_id, enabled)
  values (actor_id, false)
  on conflict (user_id) do nothing;

  select * into current_profile
  from public.cycle_profiles
  where user_id = actor_id
  for update;

  if current_profile.enabled = p_enabled then
    return jsonb_build_object(
      'enabled', current_profile.enabled,
      'opted_in_at', current_profile.opted_in_at
    );
  end if;

  if p_enabled then
    insert into public.consent_events (
      user_id, purpose, document_version, event_type
    ) values (
      actor_id, 'cycle_tracking', 'v1', 'granted'
    ) returning occurred_at into event_time;

    update public.cycle_profiles
    set enabled = true,
        opted_in_at = coalesce(opted_in_at, event_time)
    where user_id = actor_id
    returning * into current_profile;
  else
    select granted.* into grant_event
    from public.consent_events granted
    where granted.user_id = actor_id
      and granted.purpose = 'cycle_tracking'
      and granted.document_version = 'v1'
      and granted.event_type = 'granted'
      and (granted.expires_at is null or granted.expires_at > statement_timestamp())
      and not exists (
        select 1 from public.consent_events revoked
        where revoked.granted_event_id = granted.id
          and revoked.event_type = 'revoked'
      )
    order by granted.occurred_at desc
    limit 1;

    if found then
      insert into public.consent_events (
        user_id, purpose, document_version, event_type, granted_event_id
      ) values (
        actor_id, 'cycle_tracking', 'v1', 'revoked', grant_event.id
      );
    end if;

    update public.cycle_profiles
    set enabled = false
    where user_id = actor_id
    returning * into current_profile;
  end if;

  return jsonb_build_object(
    'enabled', current_profile.enabled,
    'opted_in_at', current_profile.opted_in_at
  );
end;
$$;

create or replace function public.save_cycle_period(p_payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_id uuid := coalesce(nullif(p_payload ->> 'id', '')::uuid, gen_random_uuid());
begin
  insert into public.cycle_periods (id, user_id, start_date, end_date)
  values (
    saved_id,
    (select auth.uid()),
    (p_payload ->> 'start_date')::date,
    nullif(p_payload ->> 'end_date', '')::date
  )
  on conflict (id) do update set
    start_date = excluded.start_date,
    end_date = excluded.end_date
  where cycle_periods.user_id = (select auth.uid());

  if not found then
    raise exception 'cycle period is unavailable' using errcode = '42501';
  end if;
  return saved_id;
end;
$$;

create or replace function public.save_cycle_daily_record(p_payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  record_day date := (p_payload ->> 'record_date')::date;
  saved_id uuid;
  adjacent_id uuid;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(coalesce(p_payload -> 'symptoms', '[]'::jsonb)) <> 'array' then
    raise exception 'invalid cycle record payload' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.cycle_profiles
    where user_id = actor_id and enabled
  ) then
    raise exception 'cycle tracking is disabled' using errcode = '42501';
  end if;

  insert into public.cycle_daily_records (user_id, record_date, flow, note)
  values (
    actor_id,
    record_day,
    nullif(p_payload ->> 'flow', ''),
    nullif(p_payload ->> 'note', '')
  )
  on conflict (user_id, record_date) do update set
    flow = excluded.flow,
    note = excluded.note
  returning id into saved_id;

  delete from public.cycle_daily_symptoms where record_id = saved_id;
  insert into public.cycle_daily_symptoms (record_id, symptom_id, severity)
  select
    saved_id,
    (item ->> 'symptom_id')::uuid,
    item ->> 'severity'
  from jsonb_array_elements(coalesce(p_payload -> 'symptoms', '[]'::jsonb)) item;

  -- Um fluxo informado materializa ao menos um periodo registrado. Dias
  -- adjacentes sao estendidos deterministicamente; previsoes nunca sao salvas.
  if nullif(p_payload ->> 'flow', '') is not null then
    select id into adjacent_id
    from public.cycle_periods
    where user_id = actor_id
      and start_date <= record_day + 1
      and coalesce(end_date, start_date) >= record_day - 1
    order by start_date
    limit 1;

    if adjacent_id is null then
      insert into public.cycle_periods (user_id, start_date, end_date)
      values (actor_id, record_day, record_day);
    else
      update public.cycle_periods
      set start_date = least(start_date, record_day),
          end_date = greatest(coalesce(end_date, start_date), record_day)
      where id = adjacent_id;
    end if;
  end if;

  return saved_id;
end;
$$;

create or replace function public.delete_cycle_data()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  periods_deleted bigint;
  records_deleted bigint;
  symptoms_deleted bigint;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  delete from public.cycle_daily_records where user_id = actor_id;
  get diagnostics records_deleted = row_count;
  delete from public.cycle_periods where user_id = actor_id;
  get diagnostics periods_deleted = row_count;
  delete from public.cycle_symptoms
  where owner_user_id = actor_id and origin = 'custom';
  get diagnostics symptoms_deleted = row_count;

  return jsonb_build_object(
    'periods', periods_deleted,
    'records', records_deleted,
    'custom_symptoms', symptoms_deleted
  );
end;
$$;

revoke all on function public.set_cycle_enabled(boolean) from public;
revoke all on function public.save_cycle_period(jsonb) from public;
revoke all on function public.save_cycle_daily_record(jsonb) from public;
revoke all on function public.delete_cycle_data() from public;
grant execute on function public.set_cycle_enabled(boolean) to authenticated, service_role;
grant execute on function public.save_cycle_period(jsonb) to authenticated, service_role;
grant execute on function public.save_cycle_daily_record(jsonb) to authenticated, service_role;
grant execute on function public.delete_cycle_data() to authenticated, service_role;

create or replace function public.audit_stage07_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  row_data jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  row_id uuid;
  entity_name text;
begin
  if actor_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  row_id := coalesce(row_data ->> 'id', row_data ->> 'user_id')::uuid;
  entity_name := case tg_table_name
    when 'cycle_profiles' then 'cycle_profile'
    when 'cycle_periods' then 'cycle_period'
    when 'cycle_daily_records' then 'cycle_daily_record'
    when 'cycle_symptoms' then 'cycle_symptom'
  end;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id,
    entity_name || '.' || lower(tg_op),
    entity_name,
    row_id,
    'success',
    gen_random_uuid()
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger cycle_profiles_audit_write
after insert or update on public.cycle_profiles
for each row execute function public.audit_stage07_write();
create trigger cycle_periods_audit_write
after insert or update or delete on public.cycle_periods
for each row execute function public.audit_stage07_write();
create trigger cycle_daily_records_audit_write
after insert or update or delete on public.cycle_daily_records
for each row execute function public.audit_stage07_write();
create trigger cycle_symptoms_audit_write
after insert or delete on public.cycle_symptoms
for each row execute function public.audit_stage07_write();
