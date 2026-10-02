-- Stage 10: profissionais, connections, sharing granular e notas separadas.
-- Default DENY: nenhuma tabela de dados recebe acesso profissional sem policy
-- explicita que exige connection aceita + permission vigente.

create table public.professional_profiles (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  registration_number text not null
    check (char_length(btrim(registration_number)) between 3 and 50),
  specialty text not null check (char_length(btrim(specialty)) between 2 and 80),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'pending', 'verified')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger professional_profiles_set_updated_at
before update on public.professional_profiles
for each row execute function public.set_updated_at();

create table public.professional_connections (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references public.profiles(user_id) on delete cascade,
  professional_user_id uuid not null
    references public.professional_profiles(user_id) on delete cascade,
  invited_by_user_id uuid not null references public.profiles(user_id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked')),
  invited_at timestamptz not null default timezone('utc', now()),
  accepted_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint professional_connection_distinct_people
    check (client_user_id <> professional_user_id),
  constraint professional_connection_inviter_is_client
    check (invited_by_user_id = client_user_id),
  constraint professional_connection_status_shape check (
    (status = 'pending' and accepted_at is null and revoked_at is null)
    or (status = 'accepted' and accepted_at is not null and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  ),
  constraint professional_connection_pair_unique
    unique (client_user_id, professional_user_id),
  constraint professional_connection_identity_unique
    unique (id, client_user_id, professional_user_id)
);

create index professional_connections_professional_status_idx
on public.professional_connections (professional_user_id, status, updated_at desc);

create trigger professional_connections_set_updated_at
before update on public.professional_connections
for each row execute function public.set_updated_at();

create table public.sharing_permissions (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.professional_connections(id)
    on delete cascade,
  scope text not null check (scope in (
    'emotional',
    'sleep',
    'goals',
    'journal_entry',
    'cycle',
    'reports',
    'multimodal_result',
    'multimodal_transcript',
    'multimodal_media'
  )),
  journal_entry_id uuid references public.journal_entries(id) on delete cascade,
  status text not null default 'granted' check (status in ('granted', 'revoked')),
  granted_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint sharing_permission_scope_shape check (
    (scope = 'journal_entry' and journal_entry_id is not null)
    or (scope <> 'journal_entry' and journal_entry_id is null)
  ),
  constraint sharing_permission_status_shape check (
    (status = 'granted' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  )
);

create unique index sharing_permissions_target_unique
on public.sharing_permissions (
  connection_id,
  scope,
  coalesce(journal_entry_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

create index sharing_permissions_active_idx
on public.sharing_permissions (connection_id, scope, expires_at)
where status = 'granted';

create trigger sharing_permissions_set_updated_at
before update on public.sharing_permissions
for each row execute function public.set_updated_at();

create table public.professional_notes (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  professional_user_id uuid not null,
  client_user_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint professional_notes_connection_fkey
    foreign key (connection_id, client_user_id, professional_user_id)
    references public.professional_connections(id, client_user_id, professional_user_id)
    on delete cascade
);

create index professional_notes_connection_created_idx
on public.professional_notes (connection_id, created_at desc);

create trigger professional_notes_set_updated_at
before update on public.professional_notes
for each row execute function public.set_updated_at();

alter table public.professional_profiles enable row level security;
alter table public.professional_profiles force row level security;
alter table public.professional_connections enable row level security;
alter table public.professional_connections force row level security;
alter table public.sharing_permissions enable row level security;
alter table public.sharing_permissions force row level security;
alter table public.professional_notes enable row level security;
alter table public.professional_notes force row level security;

revoke all on table public.professional_profiles from anon, authenticated;
revoke all on table public.professional_connections from anon, authenticated;
revoke all on table public.sharing_permissions from anon, authenticated;
revoke all on table public.professional_notes from anon, authenticated;

grant select on table public.professional_profiles to authenticated;
grant select on table public.professional_connections to authenticated;
grant select on table public.sharing_permissions to authenticated;
grant select, insert, update, delete on table public.professional_notes to authenticated;
grant all on table public.professional_profiles to service_role;
grant all on table public.professional_connections to service_role;
grant all on table public.sharing_permissions to service_role;
grant all on table public.professional_notes to service_role;

create policy professional_connections_select_participant
on public.professional_connections for select to authenticated
using (
  (select auth.uid()) = client_user_id
  or (select auth.uid()) = professional_user_id
);

create policy professional_profiles_select_related
on public.professional_profiles for select to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1
    from public.professional_connections connection
    where connection.professional_user_id = professional_profiles.user_id
      and connection.client_user_id = (select auth.uid())
  )
);

create policy sharing_permissions_select_participant
on public.sharing_permissions for select to authenticated
using (
  exists (
    select 1
    from public.professional_connections connection
    where connection.id = sharing_permissions.connection_id
      and (
        connection.client_user_id = (select auth.uid())
        or connection.professional_user_id = (select auth.uid())
      )
  )
);

create policy professional_notes_select_professional
on public.professional_notes for select to authenticated
using (
  professional_user_id = (select auth.uid())
  and exists (
    select 1 from public.professional_connections connection
    where connection.id = professional_notes.connection_id
      and connection.professional_user_id = (select auth.uid())
      and connection.status = 'accepted'
  )
);
create policy professional_notes_insert_professional
on public.professional_notes for insert to authenticated
with check (
  professional_user_id = (select auth.uid())
  and exists (
    select 1 from public.professional_connections connection
    where connection.id = professional_notes.connection_id
      and connection.professional_user_id = (select auth.uid())
      and connection.client_user_id = professional_notes.client_user_id
      and connection.status = 'accepted'
  )
);
create policy professional_notes_update_professional
on public.professional_notes for update to authenticated
using (
  professional_user_id = (select auth.uid())
  and exists (
    select 1 from public.professional_connections connection
    where connection.id = professional_notes.connection_id
      and connection.professional_user_id = (select auth.uid())
      and connection.status = 'accepted'
  )
)
with check (professional_user_id = (select auth.uid()));
create policy professional_notes_delete_professional
on public.professional_notes for delete to authenticated
using (
  professional_user_id = (select auth.uid())
  and exists (
    select 1 from public.professional_connections connection
    where connection.id = professional_notes.connection_id
      and connection.professional_user_id = (select auth.uid())
      and connection.status = 'accepted'
  )
);

create or replace function public.professional_access_allowed(
  p_client_user_id uuid,
  p_scope text,
  p_journal_entry_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
    from public.professional_connections connection
    join public.sharing_permissions permission
      on permission.connection_id = connection.id
    where connection.client_user_id = p_client_user_id
      and connection.professional_user_id = auth.uid()
      and connection.status = 'accepted'
      and connection.revoked_at is null
      and permission.scope = p_scope
      and permission.status = 'granted'
      and permission.revoked_at is null
      and (permission.expires_at is null or permission.expires_at > statement_timestamp())
      and (
        (p_scope = 'journal_entry' and permission.journal_entry_id = p_journal_entry_id)
        or (p_scope <> 'journal_entry' and permission.journal_entry_id is null)
      )
  ), false);
$$;

revoke all on function public.professional_access_allowed(uuid, text, uuid) from public;
grant execute on function public.professional_access_allowed(uuid, text, uuid)
to authenticated, service_role;

-- Profile basico e visivel apenas depois do aceite; nenhum dado de dominio e
-- liberado automaticamente pela connection.
create policy profiles_select_connected_professional
on public.profiles for select to authenticated
using (
  exists (
    select 1 from public.professional_connections connection
    where connection.client_user_id = profiles.user_id
      and connection.professional_user_id = (select auth.uid())
      and connection.status = 'accepted'
  )
);

create policy emotional_checkins_select_professional
on public.emotional_checkins for select to authenticated
using (public.professional_access_allowed(user_id, 'emotional'));
create policy emotional_checkin_factors_select_professional
on public.emotional_checkin_factors for select to authenticated
using (
  exists (
    select 1 from public.emotional_checkins checkin
    where checkin.id = emotional_checkin_factors.checkin_id
      and public.professional_access_allowed(checkin.user_id, 'emotional')
  )
);
create policy sleep_records_select_professional
on public.sleep_records for select to authenticated
using (public.professional_access_allowed(user_id, 'sleep'));

create policy goals_select_professional
on public.goals for select to authenticated
using (public.professional_access_allowed(user_id, 'goals'));
create policy goal_progress_select_professional
on public.goal_progress_entries for select to authenticated
using (
  exists (
    select 1 from public.goals goal
    where goal.id = goal_progress_entries.goal_id
      and public.professional_access_allowed(goal.user_id, 'goals')
  )
);

create policy journal_entries_select_professional
on public.journal_entries for select to authenticated
using (
  status = 'saved'
  and trashed_at is null
  and public.professional_access_allowed(user_id, 'journal_entry', id)
);
create policy journal_entry_tags_select_professional
on public.journal_entry_tags for select to authenticated
using (
  exists (
    select 1 from public.journal_entries entry
    where entry.id = journal_entry_tags.entry_id
      and public.professional_access_allowed(entry.user_id, 'journal_entry', entry.id)
  )
);

create policy cycle_profiles_select_professional
on public.cycle_profiles for select to authenticated
using (public.professional_access_allowed(user_id, 'cycle'));
create policy cycle_periods_select_professional
on public.cycle_periods for select to authenticated
using (public.professional_access_allowed(user_id, 'cycle'));
create policy cycle_daily_records_select_professional
on public.cycle_daily_records for select to authenticated
using (public.professional_access_allowed(user_id, 'cycle'));
create policy cycle_daily_symptoms_select_professional
on public.cycle_daily_symptoms for select to authenticated
using (
  exists (
    select 1 from public.cycle_daily_records record
    where record.id = cycle_daily_symptoms.record_id
      and public.professional_access_allowed(record.user_id, 'cycle')
  )
);

create policy report_snapshots_select_professional
on public.report_snapshots for select to authenticated
using (public.professional_access_allowed(user_id, 'reports'));

create or replace function public.upsert_professional_profile(
  p_registration_number text,
  p_specialty text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if char_length(btrim(coalesce(p_registration_number, ''))) not between 3 and 50
    or char_length(btrim(coalesce(p_specialty, ''))) not between 2 and 80 then
    raise exception 'invalid professional profile' using errcode = '22023';
  end if;

  insert into public.professional_profiles (
    user_id, registration_number, specialty, verification_status
  ) values (
    actor_id, btrim(p_registration_number), btrim(p_specialty), 'unverified'
  )
  on conflict (user_id) do update set
    registration_number = excluded.registration_number,
    specialty = excluded.specialty;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, 'professional_profile.saved', 'professional_profile', actor_id,
    'success', gen_random_uuid()
  );
  return actor_id;
end;
$$;

create or replace function public.invite_professional(p_professional_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  connection public.professional_connections%rowtype;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_professional_user_id = actor_id
    or not exists (
      select 1 from public.professional_profiles
      where user_id = p_professional_user_id
    ) then
    raise exception 'professional unavailable' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':' || p_professional_user_id::text, 0)
  );
  select * into connection from public.professional_connections
  where client_user_id = actor_id and professional_user_id = p_professional_user_id
  for update;

  if not found then
    insert into public.professional_connections (
      client_user_id, professional_user_id, invited_by_user_id
    ) values (actor_id, p_professional_user_id, actor_id)
    returning * into connection;
  elsif connection.status = 'revoked' then
    update public.professional_connections
    set status = 'pending', invited_at = statement_timestamp(), accepted_at = null,
        revoked_at = null, invited_by_user_id = actor_id
    where id = connection.id
    returning * into connection;
    update public.sharing_permissions
    set status = 'revoked', revoked_at = coalesce(revoked_at, statement_timestamp())
    where connection_id = connection.id and status = 'granted';
  end if;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, 'professional_connection.invited', 'professional_connection',
    connection.id, 'success', gen_random_uuid()
  );
  return connection.id;
end;
$$;

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

  update public.professional_connections
  set status = case when p_accept then 'accepted' else 'revoked' end,
      accepted_at = case when p_accept then statement_timestamp() else null end,
      revoked_at = case when p_accept then null else statement_timestamp() end
  where id = p_connection_id;

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

create or replace function public.revoke_professional_connection(p_connection_id uuid)
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
  where id = p_connection_id
    and actor_id in (client_user_id, professional_user_id)
  for update;
  if not found then
    raise exception 'connection unavailable' using errcode = '42501';
  end if;
  if connection.status = 'revoked' then return connection.id; end if;

  update public.professional_connections
  set status = 'revoked', revoked_at = statement_timestamp()
  where id = p_connection_id;
  update public.sharing_permissions
  set status = 'revoked', revoked_at = coalesce(revoked_at, statement_timestamp())
  where connection_id = p_connection_id and status = 'granted';

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, 'professional_connection.revoked', 'professional_connection',
    p_connection_id, 'success', gen_random_uuid()
  );
  return p_connection_id;
end;
$$;

create or replace function public.set_sharing_permission(
  p_connection_id uuid,
  p_scope text,
  p_enabled boolean,
  p_journal_entry_id uuid default null,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  permission_id uuid;
begin
  if p_scope not in (
    'emotional', 'sleep', 'goals', 'journal_entry', 'cycle', 'reports',
    'multimodal_result', 'multimodal_transcript', 'multimodal_media'
  ) then
    raise exception 'invalid sharing scope' using errcode = '22023';
  end if;
  if (p_scope = 'journal_entry') <> (p_journal_entry_id is not null) then
    raise exception 'invalid journal permission shape' using errcode = '22023';
  end if;
  if p_enabled and p_expires_at is not null and p_expires_at <= statement_timestamp() then
    raise exception 'permission expiry must be future' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.professional_connections
    where id = p_connection_id and client_user_id = actor_id and status = 'accepted'
  ) then
    raise exception 'accepted connection required' using errcode = '42501';
  end if;
  if p_scope = 'journal_entry' and not exists (
    select 1 from public.journal_entries
    where id = p_journal_entry_id and user_id = actor_id
      and status = 'saved' and trashed_at is null
  ) then
    raise exception 'owned active journal entry required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_connection_id::text || ':' || p_scope || ':' || coalesce(p_journal_entry_id::text, '-'),
      0
    )
  );
  select id into permission_id from public.sharing_permissions
  where connection_id = p_connection_id
    and scope = p_scope
    and journal_entry_id is not distinct from p_journal_entry_id
  for update;

  if permission_id is null and p_enabled then
    insert into public.sharing_permissions (
      connection_id, scope, journal_entry_id, status, expires_at
    ) values (
      p_connection_id, p_scope, p_journal_entry_id, 'granted', p_expires_at
    ) returning id into permission_id;
  elsif permission_id is not null then
    update public.sharing_permissions
    set status = case when p_enabled then 'granted' else 'revoked' end,
        granted_at = case when p_enabled then statement_timestamp() else granted_at end,
        expires_at = case when p_enabled then p_expires_at else expires_at end,
        revoked_at = case when p_enabled then null else statement_timestamp() end
    where id = permission_id;
  end if;

  if permission_id is not null then
    insert into public.audit_logs (
      actor_user_id, action, entity_type, entity_id, outcome, correlation_id
    ) values (
      actor_id,
      case when p_enabled then 'sharing_permission.granted'
           else 'sharing_permission.revoked' end,
      'sharing_permission', permission_id, 'success', gen_random_uuid()
    );
  end if;
  return permission_id;
end;
$$;

create or replace function public.audit_professional_note_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    auth.uid(), 'professional_note.' || lower(tg_op), 'professional_note',
    case when tg_op = 'DELETE' then old.id else new.id end,
    'success', gen_random_uuid()
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger professional_notes_audit_write
after insert or update or delete on public.professional_notes
for each row execute function public.audit_professional_note_write();

revoke all on function public.upsert_professional_profile(text, text) from public;
revoke all on function public.invite_professional(uuid) from public;
revoke all on function public.respond_professional_invitation(uuid, boolean) from public;
revoke all on function public.revoke_professional_connection(uuid) from public;
revoke all on function public.set_sharing_permission(uuid, text, boolean, uuid, timestamptz) from public;
revoke all on function public.audit_professional_note_write() from public;
grant execute on function public.upsert_professional_profile(text, text) to authenticated, service_role;
grant execute on function public.invite_professional(uuid) to authenticated, service_role;
grant execute on function public.respond_professional_invitation(uuid, boolean) to authenticated, service_role;
grant execute on function public.revoke_professional_connection(uuid) to authenticated, service_role;
grant execute on function public.set_sharing_permission(uuid, text, boolean, uuid, timestamptz) to authenticated, service_role;
