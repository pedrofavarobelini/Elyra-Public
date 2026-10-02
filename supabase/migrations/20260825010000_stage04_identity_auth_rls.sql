-- Stage 04: fundacao de identidade, consentimento, auditoria e Storage privado.
-- Migration aditiva. Nenhuma entidade de Stages 05+ e antecipada aqui.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  checkin_reminder boolean not null default true,
  goal_reminder boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.consent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose ~ '^[a-z][a-z0-9_]{2,63}$'),
  document_version text not null check (document_version ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$'),
  event_type text not null check (event_type in ('granted', 'revoked')),
  granted_event_id uuid references public.consent_events(id) on delete restrict,
  occurred_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz,
  constraint consent_event_shape check (
    (event_type = 'granted' and granted_event_id is null)
    or (event_type = 'revoked' and granted_event_id is not null)
  ),
  constraint consent_expiry_after_event check (
    expires_at is null or expires_at > occurred_at
  )
);

create or replace function public.validate_consent_revocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_event public.consent_events%rowtype;
begin
  if new.event_type <> 'revoked' then
    return new;
  end if;

  select * into grant_event
  from public.consent_events
  where id = new.granted_event_id;

  if not found
    or grant_event.event_type <> 'granted'
    or grant_event.user_id <> new.user_id
    or grant_event.purpose <> new.purpose
    or grant_event.document_version <> new.document_version then
    raise exception 'invalid consent revocation';
  end if;

  return new;
end;
$$;

create trigger consent_revocation_validate
before insert on public.consent_events
for each row execute function public.validate_consent_revocation();

create unique index consent_single_revocation_idx
  on public.consent_events (granted_event_id)
  where event_type = 'revoked';
create index consent_user_purpose_time_idx
  on public.consent_events (user_id, purpose, occurred_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action ~ '^[a-z][a-z0-9_.]{2,79}$'),
  entity_type text not null check (entity_type ~ '^[a-z][a-z0-9_]{1,39}$'),
  entity_id uuid,
  outcome text not null check (outcome in ('success', 'denied', 'failure')),
  correlation_id uuid not null default gen_random_uuid(),
  occurred_at timestamptz not null default timezone('utc', now())
);

create index audit_actor_time_idx
  on public.audit_logs (actor_user_id, occurred_at desc);
create index audit_correlation_idx
  on public.audit_logs (correlation_id);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger preferences_set_updated_at
before update on public.user_preferences
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_display_name text;
begin
  safe_display_name := nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '');
  safe_display_name := coalesce(safe_display_name, nullif(split_part(new.email, '@', 1), ''), 'Pessoa');

  insert into public.profiles (user_id, display_name)
  values (new.id, left(safe_display_name, 80));

  insert into public.user_preferences (user_id)
  values (new.id);

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.user_preferences enable row level security;
alter table public.user_preferences force row level security;
alter table public.consent_events enable row level security;
alter table public.consent_events force row level security;
alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.user_preferences from anon, authenticated;
revoke all on table public.consent_events from anon, authenticated;
revoke all on table public.audit_logs from anon, authenticated;

grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update on table public.user_preferences to authenticated;
grant select, insert on table public.consent_events to authenticated;
grant select, insert on table public.audit_logs to authenticated;
grant all on table public.profiles to service_role;
grant all on table public.user_preferences to service_role;
grant all on table public.consent_events to service_role;
grant all on table public.audit_logs to service_role;

create policy profiles_select_own
on public.profiles for select to authenticated
using ((select auth.uid()) = user_id);
create policy profiles_insert_own
on public.profiles for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy profiles_update_own
on public.profiles for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy preferences_select_own
on public.user_preferences for select to authenticated
using ((select auth.uid()) = user_id);
create policy preferences_insert_own
on public.user_preferences for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy preferences_update_own
on public.user_preferences for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy consent_select_own
on public.consent_events for select to authenticated
using ((select auth.uid()) = user_id);
create policy consent_insert_own
on public.consent_events for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy audit_select_own
on public.audit_logs for select to authenticated
using ((select auth.uid()) = actor_user_id);
create policy audit_insert_own
on public.audit_logs for insert to authenticated
with check ((select auth.uid()) = actor_user_id);

insert into storage.buckets (id, name, public, file_size_limit)
values ('elyra-private', 'elyra-private', false, 5242880)
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit;

create policy private_bucket_read_own
on storage.objects for select to authenticated
using (
  bucket_id = 'elyra-private'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy private_bucket_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'elyra-private'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy private_bucket_update_own
on storage.objects for update to authenticated
using (
  bucket_id = 'elyra-private'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'elyra-private'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy private_bucket_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'elyra-private'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
