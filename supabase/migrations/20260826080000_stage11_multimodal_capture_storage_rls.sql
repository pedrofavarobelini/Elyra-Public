-- Stage 11A: captura multimodal, midia privada e cleanup verificavel.
-- Retencao ratificada por ADR-0004. Stage 12/13 continuam fora desta migration.

alter table public.user_preferences
add column sessions_enabled boolean not null default false;

create table public.multimodal_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  kind text not null check (kind in ('guided', 'free', 'deep_checkin')),
  status text not null default 'preparing' check (status in (
    'preparing', 'capturing', 'paused', 'completed', 'cancelled',
    'cleanup_pending', 'deleted', 'error'
  )),
  screen_consent boolean not null default false,
  camera_consent boolean not null default false,
  microphone_consent boolean not null default false,
  transcription_consent boolean not null default false,
  storage_consent boolean not null default false,
  ai_analysis_consent boolean not null default false,
  share_result_consent boolean not null default false,
  share_transcript_consent boolean not null default false,
  share_original_consent boolean not null default false,
  training_eligibility_consent boolean not null default false,
  started_at timestamptz not null default timezone('utc', now()),
  ended_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint multimodal_session_has_capture_consent check (
    screen_consent or camera_consent or microphone_consent
  ),
  constraint multimodal_share_transcript_requires_transcription check (
    not share_transcript_consent or transcription_consent
  ),
  constraint multimodal_transcription_requires_microphone check (
    not transcription_consent or microphone_consent
  ),
  constraint multimodal_share_original_requires_storage check (
    not share_original_consent or storage_consent
  ),
  constraint multimodal_stage11_learning_closed check (
    training_eligibility_consent = false
  )
);

create index multimodal_sessions_owner_started_idx
on public.multimodal_sessions (user_id, started_at desc)
where status <> 'deleted';

create trigger multimodal_sessions_set_updated_at
before update on public.multimodal_sessions
for each row execute function public.set_updated_at();

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.multimodal_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  media_kind text not null check (media_kind in ('screen', 'camera', 'microphone')),
  storage_path text not null unique,
  mime_type text not null check (mime_type in (
    'video/webm', 'video/mp4', 'audio/webm', 'audio/ogg', 'audio/mp4'
  )),
  size_bytes bigint not null check (size_bytes between 1 and 5242880),
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 3600000),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  retention_until timestamptz not null
    default (timezone('utc', now()) + interval '7 days'),
  status text not null default 'uploading'
    check (status in ('uploading', 'stored', 'interrupted', 'deleting')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  constraint media_asset_path_is_private check (
    storage_path !~* '^https?://' and position('..' in storage_path) = 0
  ),
  constraint media_asset_status_shape check (
    (status = 'deleting' and deleted_at is not null)
    or (status <> 'deleting' and deleted_at is null)
  )
);

create index media_assets_session_status_idx
on public.media_assets (session_id, status, created_at);
create index media_assets_retention_idx
on public.media_assets (retention_until)
where status = 'stored';

create trigger media_assets_set_updated_at
before update on public.media_assets
for each row execute function public.set_updated_at();

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.multimodal_sessions(id) on delete cascade,
  media_asset_id uuid references public.media_assets(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  job_kind text not null check (job_kind in ('upload_finalize', 'media_cleanup')),
  status text not null default 'queued' check (status in (
    'queued', 'running', 'cancel_requested', 'cancelled', 'succeeded', 'failed'
  )),
  attempts smallint not null default 0 check (attempts between 0 and 20),
  error_code text check (
    error_code is null or char_length(error_code) between 1 and 80
  ),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint processing_job_status_shape check (
    (status in ('queued', 'cancel_requested') and finished_at is null)
    or (status = 'running' and started_at is not null and finished_at is null)
    or (status in ('cancelled', 'succeeded', 'failed') and finished_at is not null)
  )
);

create index processing_jobs_session_status_idx
on public.processing_jobs (session_id, status, created_at);

create trigger processing_jobs_set_updated_at
before update on public.processing_jobs
for each row execute function public.set_updated_at();

create or replace function public.protect_multimodal_session_contract()
returns trigger language plpgsql set search_path = '' as $$
begin
  if row(
    new.user_id, new.kind, new.screen_consent, new.camera_consent,
    new.microphone_consent, new.transcription_consent, new.storage_consent,
    new.ai_analysis_consent, new.share_result_consent,
    new.share_transcript_consent, new.share_original_consent,
    new.training_eligibility_consent, new.started_at, new.created_at
  ) is distinct from row(
    old.user_id, old.kind, old.screen_consent, old.camera_consent,
    old.microphone_consent, old.transcription_consent, old.storage_consent,
    old.ai_analysis_consent, old.share_result_consent,
    old.share_transcript_consent, old.share_original_consent,
    old.training_eligibility_consent, old.started_at, old.created_at
  ) then
    raise exception 'multimodal session contract is immutable' using errcode = '42501';
  end if;
  if not (
    (old.status = 'preparing' and new.status in ('preparing', 'capturing', 'cancelled', 'cleanup_pending', 'error'))
    or (old.status = 'capturing' and new.status in ('capturing', 'paused', 'completed', 'cancelled', 'cleanup_pending', 'error'))
    or (old.status = 'paused' and new.status in ('paused', 'capturing', 'completed', 'cancelled', 'cleanup_pending', 'error'))
    or (old.status in ('completed', 'cancelled', 'error') and new.status in (old.status, 'cleanup_pending'))
    or (old.status = 'cleanup_pending' and new.status in ('cleanup_pending', 'deleted'))
    or (old.status = 'deleted' and new.status = 'deleted')
  ) then
    raise exception 'invalid multimodal session transition' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger multimodal_sessions_protect_contract
before update on public.multimodal_sessions
for each row execute function public.protect_multimodal_session_contract();

create or replace function public.protect_media_asset_contract()
returns trigger language plpgsql set search_path = '' as $$
begin
  if row(
    new.session_id, new.user_id, new.media_kind, new.storage_path,
    new.mime_type, new.size_bytes, new.duration_ms, new.checksum_sha256,
    new.retention_until, new.created_at
  ) is distinct from row(
    old.session_id, old.user_id, old.media_kind, old.storage_path,
    old.mime_type, old.size_bytes, old.duration_ms, old.checksum_sha256,
    old.retention_until, old.created_at
  ) then
    raise exception 'media asset contract is immutable' using errcode = '42501';
  end if;
  if not (
    old.status = new.status
    or (old.status = 'uploading' and new.status in ('stored', 'interrupted', 'deleting'))
    or (old.status in ('stored', 'interrupted') and new.status = 'deleting')
  ) then
    raise exception 'invalid media asset transition' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger media_assets_protect_contract
before update on public.media_assets
for each row execute function public.protect_media_asset_contract();

alter table public.multimodal_sessions enable row level security;
alter table public.multimodal_sessions force row level security;
alter table public.media_assets enable row level security;
alter table public.media_assets force row level security;
alter table public.processing_jobs enable row level security;
alter table public.processing_jobs force row level security;

revoke all on table public.multimodal_sessions from anon, authenticated;
revoke all on table public.media_assets from anon, authenticated;
revoke all on table public.processing_jobs from anon, authenticated;
grant select, insert, update on table public.multimodal_sessions to authenticated;
grant select, insert, update, delete on table public.media_assets to authenticated;
grant select, insert, update on table public.processing_jobs to authenticated;
grant all on table public.multimodal_sessions to service_role;
grant all on table public.media_assets to service_role;
grant all on table public.processing_jobs to service_role;

create policy multimodal_sessions_select_own
on public.multimodal_sessions for select to authenticated
using ((select auth.uid()) = user_id);
create policy multimodal_sessions_insert_own
on public.multimodal_sessions for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.user_preferences preference
    where preference.user_id = (select auth.uid()) and preference.sessions_enabled
  )
);
create policy multimodal_sessions_update_own
on public.multimodal_sessions for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy multimodal_sessions_select_professional
on public.multimodal_sessions for select to authenticated
using (
  (share_result_consent and public.professional_access_allowed(user_id, 'multimodal_result'))
  or (share_transcript_consent and public.professional_access_allowed(user_id, 'multimodal_transcript'))
  or (share_original_consent and public.professional_access_allowed(user_id, 'multimodal_media'))
);

create policy media_assets_select_own
on public.media_assets for select to authenticated
using ((select auth.uid()) = user_id);
create policy media_assets_insert_own
on public.media_assets for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and storage_path like user_id::text || '/multimodal/' || session_id::text || '/%'
  and exists (
    select 1 from public.multimodal_sessions session
    where session.id = media_assets.session_id
      and session.user_id = media_assets.user_id
      and session.storage_consent
      and session.status in ('capturing', 'paused')
      and case media_assets.media_kind
        when 'screen' then session.screen_consent
        when 'camera' then session.camera_consent
        when 'microphone' then session.microphone_consent
        else false
      end
  )
);
create policy media_assets_update_own
on public.media_assets for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy media_assets_delete_own
on public.media_assets for delete to authenticated
using ((select auth.uid()) = user_id);
create policy media_assets_select_professional
on public.media_assets for select to authenticated
using (
  status = 'stored'
  and exists (
    select 1 from public.multimodal_sessions session
    where session.id = media_assets.session_id
      and session.user_id = media_assets.user_id
      and session.share_original_consent
      and public.professional_access_allowed(media_assets.user_id, 'multimodal_media')
  )
);

create policy processing_jobs_select_own
on public.processing_jobs for select to authenticated
using ((select auth.uid()) = user_id);
create policy processing_jobs_insert_own
on public.processing_jobs for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.multimodal_sessions session
    where session.id = processing_jobs.session_id
      and session.user_id = processing_jobs.user_id
  )
  and (
    media_asset_id is null
    or exists (
      select 1 from public.media_assets asset
      where asset.id = processing_jobs.media_asset_id
        and asset.session_id = processing_jobs.session_id
        and asset.user_id = processing_jobs.user_id
    )
  )
);
create policy processing_jobs_update_own
on public.processing_jobs for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy private_bucket_read_shared_multimodal
on storage.objects for select to authenticated
using (
  bucket_id = 'elyra-private'
  and exists (
    select 1
    from public.media_assets asset
    join public.multimodal_sessions session on session.id = asset.session_id
    where asset.storage_path = storage.objects.name
      and asset.status = 'stored'
      and session.share_original_consent
      and public.professional_access_allowed(asset.user_id, 'multimodal_media')
  )
);

create or replace function public.audit_stage11_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  row_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
  entity_name text := case tg_table_name
    when 'multimodal_sessions' then 'multimodal_session'
    when 'media_assets' then 'media_asset'
  end;
begin
  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, entity_name || '.' || lower(tg_op), entity_name, row_id,
    'success', gen_random_uuid()
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger multimodal_sessions_audit_write
after insert or update on public.multimodal_sessions
for each row execute function public.audit_stage11_write();
create trigger media_assets_audit_write
after insert or update or delete on public.media_assets
for each row execute function public.audit_stage11_write();

revoke all on function public.protect_multimodal_session_contract() from public;
revoke all on function public.protect_media_asset_contract() from public;
revoke all on function public.audit_stage11_write() from public;
