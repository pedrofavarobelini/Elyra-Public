-- Stage 29 / PRO-7 — Sessoes profissionais protegidas.
--
-- Aditiva. Tres tabelas novas (sessao, participantes, credenciais efemeras),
-- uma trilha sem conteudo, uma coluna nula nova em `multimodal_sessions`
-- (`professional_session_id`) e gatilhos que so agem quando essa coluna esta
-- preenchida: a sessao pessoal continua exatamente como era.
--
-- Nao ha chamada remota (video/audio entre as partes): nenhum provider foi
-- aprovado (REMOTE_CALL = NOT_IMPLEMENTED). A captura e a da propria pessoa,
-- pela arquitetura multimodal existente, sob os consentimentos desta sessao.
--
-- Politica de artefato (decidida antes desta migration, D-P7-06):
--   revogar audio/video/transcricao/IA bloqueia NOVA coleta; o que ja existe
--   continua da pessoa, sob os controles pessoais; revogar o acesso do
--   profissional a transcricao bloqueia a proxima leitura, imediatamente.

-- ---------------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------------

create table public.professional_sessions (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  connection_id uuid not null references public.professional_connections(id) on delete cascade,
  client_user_id uuid not null references public.profiles(user_id) on delete cascade,
  professional_user_id uuid not null references public.profiles(user_id) on delete cascade,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  -- `ready` e `expired` tambem sao derivados na leitura (janela); o valor
  -- persistido so avanca por transicao explicita ou limpeza.
  status text not null default 'scheduled'
    check (status in ('scheduled', 'active', 'completed', 'cancelled', 'expired')),
  allow_audio boolean not null default false,
  allow_video boolean not null default false,
  allow_transcription boolean not null default false,
  allow_ai_derivation boolean not null default false,
  allow_professional_transcript_access boolean not null default false,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint professional_sessions_distinct_people check (client_user_id <> professional_user_id),
  constraint professional_sessions_window check (closes_at > opens_at),
  constraint professional_sessions_transcription_needs_audio check (not allow_transcription or allow_audio),
  constraint professional_sessions_transcript_access_needs_transcription
    check (not allow_professional_transcript_access or allow_transcription),
  constraint professional_sessions_status_shape check (
    (status = 'scheduled' and started_at is null and completed_at is null and cancelled_at is null and expired_at is null)
    or (status = 'active' and started_at is not null and completed_at is null and cancelled_at is null and expired_at is null)
    or (status = 'completed' and completed_at is not null and cancelled_at is null and expired_at is null)
    or (status = 'cancelled' and cancelled_at is not null and completed_at is null and expired_at is null)
    or (status = 'expired' and expired_at is not null and completed_at is null and cancelled_at is null)
  )
);

create index professional_sessions_client_idx on public.professional_sessions (client_user_id, opens_at);
create index professional_sessions_professional_idx on public.professional_sessions (professional_user_id, opens_at);

create trigger professional_sessions_set_updated_at
before update on public.professional_sessions
for each row execute function public.set_updated_at();

create table public.session_participants (
  session_id uuid not null references public.professional_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  role text not null check (role in ('client', 'professional')),
  present boolean not null default false,
  entered_count integer not null default 0 check (entered_count between 0 and 1000),
  first_entered_at timestamptz,
  last_entered_at timestamptz,
  left_at timestamptz,
  primary key (session_id, user_id),
  unique (session_id, role)
);

-- Credencial efemera: so o digest. Nunca texto claro, nunca legivel por ninguem
-- alem das RPCs (sem grant para authenticated, anon nem service_role).
create table public.session_access_credentials (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.professional_sessions(id) on delete cascade,
  participant_user_id uuid not null references public.profiles(user_id) on delete cascade,
  token_digest bytea not null unique check (octet_length(token_digest) = 32),
  issued_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  constraint session_credentials_ttl check (
    expires_at > issued_at and expires_at <= issued_at + interval '2 minutes'
  )
);

create index session_access_credentials_lookup_idx
  on public.session_access_credentials (session_id, participant_user_id, issued_at desc);

create table public.professional_session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.professional_sessions(id) on delete cascade,
  subject_user_id uuid not null references public.profiles(user_id) on delete cascade,
  actor_user_id uuid references public.profiles(user_id) on delete set null,
  connection_id uuid not null,
  event text not null check (event in (
    'SESSION_CREATED', 'SESSION_ENTERED', 'SESSION_LEFT', 'SESSION_STARTED', 'SESSION_COMPLETED',
    'SESSION_CANCELLED', 'SESSION_EXPIRED', 'CONSENT_CHANGED', 'PROFESSIONAL_VIEWED_SESSION_SUMMARY',
    'PROFESSIONAL_VIEWED_TRANSCRIPT', 'CREDENTIAL_ISSUED', 'CREDENTIAL_REJECTED'
  )),
  -- Metadado fechado (qual consentimento, para qual valor). Nunca conteudo.
  detail text check (detail is null or detail ~ '^(allow_audio|allow_video|allow_transcription|allow_ai_derivation|allow_professional_transcript_access):(on|off)$'
    or detail in ('credential_invalid', 'session_closed', 'not_allowed', 'not_available')),
  result text not null check (result in ('success', 'denied')),
  occurred_at timestamptz not null default statement_timestamp(),
  correlation_id uuid not null default gen_random_uuid(),
  policy_version text not null default 'pro7-v1' check (policy_version = 'pro7-v1')
);

create index professional_session_events_session_idx
  on public.professional_session_events (session_id, occurred_at);

-- ---------------------------------------------------------------------------
-- 2. RLS fail-closed
-- ---------------------------------------------------------------------------

alter table public.professional_sessions enable row level security;
alter table public.professional_sessions force row level security;
alter table public.session_participants enable row level security;
alter table public.session_participants force row level security;
alter table public.session_access_credentials enable row level security;
alter table public.session_access_credentials force row level security;
alter table public.professional_session_events enable row level security;
alter table public.professional_session_events force row level security;

revoke all on table public.professional_sessions, public.session_participants,
  public.session_access_credentials, public.professional_session_events
  from public, anon, authenticated, service_role;

grant select on table public.professional_sessions, public.session_participants,
  public.professional_session_events to authenticated;
-- service_role: leitura para export/QA e limpeza; nenhuma escrita de produto.
grant select, delete on table public.professional_sessions, public.session_participants,
  public.professional_session_events to service_role;
grant delete on table public.session_access_credentials to service_role;

create policy professional_sessions_select_participant
on public.professional_sessions for select to authenticated
using (auth.uid() in (client_user_id, professional_user_id));

create policy session_participants_select_participant
on public.session_participants for select to authenticated
using (exists (
  select 1 from public.professional_sessions session
  where session.id = session_participants.session_id
    and auth.uid() in (session.client_user_id, session.professional_user_id)
));

create policy professional_session_events_select_participant
on public.professional_session_events for select to authenticated
using (exists (
  select 1 from public.professional_sessions session
  where session.id = professional_session_events.session_id
    and auth.uid() in (session.client_user_id, session.professional_user_id)
));

create policy professional_sessions_service_read on public.professional_sessions
  for select to service_role using (true);
create policy professional_sessions_service_delete on public.professional_sessions
  for delete to service_role using (true);
create policy session_participants_service_read on public.session_participants
  for select to service_role using (true);
create policy session_participants_service_delete on public.session_participants
  for delete to service_role using (true);
create policy professional_session_events_service_read on public.professional_session_events
  for select to service_role using (true);
create policy professional_session_events_service_delete on public.professional_session_events
  for delete to service_role using (true);
create policy session_access_credentials_service_delete on public.session_access_credentials
  for delete to service_role using (true);

-- ---------------------------------------------------------------------------
-- 3. Estado efetivo (janela) — a seguranca nao depende de job
-- ---------------------------------------------------------------------------

create or replace function public.professional_session_effective_status(
  p_status text,
  p_opens_at timestamptz,
  p_closes_at timestamptz
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_status in ('completed', 'cancelled', 'expired') then p_status
    when p_status = 'active' and statement_timestamp() >= p_closes_at then 'completed'
    when p_status = 'active' then 'active'
    when statement_timestamp() >= p_closes_at then 'expired'
    when statement_timestamp() >= p_opens_at then 'ready'
    else 'scheduled'
  end;
$$;

grant execute on function public.professional_session_effective_status(text, timestamptz, timestamptz)
  to authenticated, service_role;

create or replace function public.professional_session_event(
  p_session public.professional_sessions,
  p_actor uuid,
  p_event text,
  p_result text,
  p_detail text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.professional_session_events (session_id, subject_user_id, actor_user_id, connection_id, event, result, detail)
  values (p_session.id, p_session.client_user_id, p_actor, p_session.connection_id, p_event, p_result, p_detail);
$$;

revoke all on function public.professional_session_event(public.professional_sessions, uuid, text, text, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. A sessao nasce da confirmacao (1 por appointment) e segue o appointment
-- ---------------------------------------------------------------------------

create or replace function public.professional_sessions_follow_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  session public.professional_sessions%rowtype;
begin
  if new.status = 'confirmed' then
    insert into public.professional_sessions (
      appointment_id, connection_id, client_user_id, professional_user_id, opens_at, closes_at
    ) values (
      new.id, new.connection_id, new.client_user_id, new.professional_user_id,
      new.starts_at - interval '10 minutes', new.ends_at + interval '15 minutes'
    )
    on conflict (appointment_id) do nothing
    returning * into session;
    if session.id is not null then
      insert into public.session_participants (session_id, user_id, role) values
        (session.id, new.client_user_id, 'client'),
        (session.id, new.professional_user_id, 'professional');
      perform public.professional_session_event(session, null, 'SESSION_CREATED', 'success');
    end if;
    return new;
  end if;

  select * into session from public.professional_sessions where appointment_id = new.id;
  if session.id is null then
    return new;
  end if;

  if new.status in ('cancelled', 'completed', 'no_show') then
    update public.session_access_credentials
      set revoked_at = coalesce(revoked_at, statement_timestamp())
      where session_id = session.id and revoked_at is null;
    update public.session_participants set present = false where session_id = session.id;
  end if;

  if new.status = 'cancelled' and session.status in ('scheduled', 'active') then
    update public.professional_sessions
      set status = 'cancelled', cancelled_at = statement_timestamp()
      where id = session.id
      returning * into session;
    perform public.professional_session_event(session, new.cancelled_by, 'SESSION_CANCELLED', 'success');
  elsif new.status = 'completed' and session.status in ('scheduled', 'active') then
    update public.professional_sessions
      set status = 'completed', completed_at = statement_timestamp()
      where id = session.id
      returning * into session;
    perform public.professional_session_event(session, new.professional_user_id, 'SESSION_COMPLETED', 'success');
  elsif new.status = 'no_show' and session.status = 'scheduled' then
    update public.professional_sessions
      set status = 'expired', expired_at = statement_timestamp()
      where id = session.id
      returning * into session;
    perform public.professional_session_event(session, new.professional_user_id, 'SESSION_EXPIRED', 'success');
  elsif new.status = 'no_show' and session.status = 'active' then
    update public.professional_sessions
      set status = 'completed', completed_at = statement_timestamp()
      where id = session.id
      returning * into session;
    perform public.professional_session_event(session, new.professional_user_id, 'SESSION_COMPLETED', 'success');
  end if;
  return new;
end;
$$;

revoke all on function public.professional_sessions_follow_appointment() from public, anon, authenticated, service_role;

create trigger appointments_professional_session
after insert or update of status on public.appointments
for each row execute function public.professional_sessions_follow_appointment();

-- Horarios ja confirmados antes desta migration ganham sessao (idempotente).
insert into public.professional_sessions (appointment_id, connection_id, client_user_id, professional_user_id, opens_at, closes_at)
select appt.id, appt.connection_id, appt.client_user_id, appt.professional_user_id,
  appt.starts_at - interval '10 minutes', appt.ends_at + interval '15 minutes'
from public.appointments appt
where appt.status = 'confirmed'
on conflict (appointment_id) do nothing;

insert into public.session_participants (session_id, user_id, role)
select session.id, session.client_user_id, 'client' from public.professional_sessions session
union all
select session.id, session.professional_user_id, 'professional' from public.professional_sessions session
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 5. Leitura
-- ---------------------------------------------------------------------------

/*
  Resumo da sessao para um participante. Quando quem le e o profissional, a
  leitura entra na trilha (PROFESSIONAL_VIEWED_SESSION_SUMMARY). Diz se ha
  transcricao e se ela esta liberada, sem o conteudo.
*/
create or replace function public.get_professional_session(p_session_id uuid)
returns table (
  id uuid,
  appointment_id uuid,
  role text,
  counterpart_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  modality text,
  opens_at timestamptz,
  closes_at timestamptz,
  status text,
  allow_audio boolean,
  allow_video boolean,
  allow_transcription boolean,
  allow_ai_derivation boolean,
  allow_professional_transcript_access boolean,
  me_present boolean,
  me_entered_count integer,
  other_present boolean,
  other_entered_count integer,
  capture_count integer,
  transcript_available boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  actor uuid := auth.uid();
  session public.professional_sessions%rowtype;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into session from public.professional_sessions s
  where s.id = p_session_id and actor in (s.client_user_id, s.professional_user_id);
  if session.id is null then
    return;
  end if;
  if actor = session.professional_user_id then
    perform public.professional_session_event(session, actor, 'PROFESSIONAL_VIEWED_SESSION_SUMMARY', 'success');
  end if;

  return query
  select
    session.id,
    session.appointment_id,
    case when actor = session.professional_user_id then 'professional' else 'client' end,
    case when actor = session.professional_user_id
      then client_profile.display_name
      else coalesce(public_profile.display_name, pro_profile.display_name)
    end,
    appt.starts_at, appt.ends_at, appt.timezone, appt.modality,
    session.opens_at, session.closes_at,
    public.professional_session_effective_status(session.status, session.opens_at, session.closes_at),
    session.allow_audio, session.allow_video, session.allow_transcription,
    session.allow_ai_derivation, session.allow_professional_transcript_access,
    me.present, me.entered_count, other.present, other.entered_count,
    (select count(*)::int from public.multimodal_sessions capture
      where capture.professional_session_id = session.id and capture.status <> 'deleted'),
    exists (
      select 1 from public.multimodal_sessions capture
      join public.session_transcripts transcript on transcript.session_id = capture.id
      where capture.professional_session_id = session.id and transcript.status = 'available'
    )
  from public.appointments appt
  join public.session_participants me on me.session_id = session.id and me.user_id = actor
  join public.session_participants other on other.session_id = session.id and other.user_id <> actor
  left join public.profiles client_profile on client_profile.user_id = session.client_user_id
  left join public.profiles pro_profile on pro_profile.user_id = session.professional_user_id
  left join public.professional_public_profiles public_profile on public_profile.user_id = session.professional_user_id
  where appt.id = session.appointment_id;
end;
$$;

revoke all on function public.get_professional_session(uuid) from public, anon, service_role;
grant execute on function public.get_professional_session(uuid) to authenticated;

create or replace function public.list_my_professional_sessions(p_since timestamptz)
returns table (
  id uuid,
  appointment_id uuid,
  role text,
  counterpart_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  modality text,
  opens_at timestamptz,
  closes_at timestamptz,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    session.id, session.appointment_id,
    case when session.professional_user_id = auth.uid() then 'professional' else 'client' end,
    case when session.professional_user_id = auth.uid()
      then client_profile.display_name
      else coalesce(public_profile.display_name, pro_profile.display_name)
    end,
    appt.starts_at, appt.ends_at, appt.timezone, appt.modality,
    session.opens_at, session.closes_at,
    public.professional_session_effective_status(session.status, session.opens_at, session.closes_at)
  from public.professional_sessions session
  join public.appointments appt on appt.id = session.appointment_id
  left join public.profiles client_profile on client_profile.user_id = session.client_user_id
  left join public.profiles pro_profile on pro_profile.user_id = session.professional_user_id
  left join public.professional_public_profiles public_profile on public_profile.user_id = session.professional_user_id
  where auth.uid() in (session.client_user_id, session.professional_user_id)
    and appt.starts_at >= coalesce(p_since, statement_timestamp() - interval '30 days')
  order by appt.starts_at
  limit 200;
$$;

revoke all on function public.list_my_professional_sessions(timestamptz) from public, anon, service_role;
grant execute on function public.list_my_professional_sessions(timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Credencial efemera: emitir e trocar
-- ---------------------------------------------------------------------------

create or replace function public.session_credential_digest(p_token text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select extensions.digest(convert_to(p_token, 'UTF8'), 'sha256');
$$;

revoke all on function public.session_credential_digest(text) from public, anon, authenticated, service_role;

/*
  Emite uma credencial de uso unico para o proprio participante. Devolve o texto
  claro UMA vez; o banco guarda so o digest. Exige sessao autenticada (o token
  nao substitui login), janela aberta e estado que admite entrada. Revoga as
  anteriores do mesmo participante e limpa as velhas desta sessao.
*/
create or replace function public.issue_professional_session_credential(p_session_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  session public.professional_sessions%rowtype;
  token text;
  recent integer;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into session from public.professional_sessions s
  where s.id = p_session_id and actor in (s.client_user_id, s.professional_user_id)
  for update;
  if session.id is null then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  if public.professional_session_effective_status(session.status, session.opens_at, session.closes_at)
     not in ('ready', 'active') then
    raise exception 'session_closed' using errcode = '22023';
  end if;
  if actor = session.professional_user_id and not public.professional_verification_is_current(actor) then
    raise exception 'verification_required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.professional_connections connection
    where connection.id = session.connection_id and connection.status = 'active'
  ) then
    raise exception 'relationship_inactive' using errcode = '42501';
  end if;

  select count(*) into recent from public.session_access_credentials credential
  where credential.session_id = session.id and credential.participant_user_id = actor
    and credential.issued_at > statement_timestamp() - interval '10 minutes';
  if recent >= 6 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  delete from public.session_access_credentials credential
  where credential.session_id = session.id
    and coalesce(credential.used_at, credential.revoked_at, credential.expires_at)
        < statement_timestamp() - interval '1 hour';
  update public.session_access_credentials credential
    set revoked_at = statement_timestamp()
    where credential.session_id = session.id and credential.participant_user_id = actor
      and credential.revoked_at is null and credential.used_at is null;

  token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into public.session_access_credentials (session_id, participant_user_id, token_digest, expires_at)
  values (session.id, actor, public.session_credential_digest(token),
          least(statement_timestamp() + interval '2 minutes', session.closes_at));
  perform public.professional_session_event(session, actor, 'CREDENTIAL_ISSUED', 'success');
  return token;
end;
$$;

revoke all on function public.issue_professional_session_credential(uuid) from public, anon, service_role;
grant execute on function public.issue_professional_session_credential(uuid) to authenticated;

/*
  Troca a credencial pela presenca. Devolve um resultado em texto em vez de
  lancar erro, para que a recusa fique na trilha (um raise desfaria o evento).
    entered | credential_invalid | session_closed | not_found
*/
create or replace function public.enter_professional_session(p_session_id uuid, p_token text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  session public.professional_sessions%rowtype;
  credential_id uuid;
  effective text;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into session from public.professional_sessions s
  where s.id = p_session_id and actor in (s.client_user_id, s.professional_user_id)
  for update;
  if session.id is null then
    return 'not_found';
  end if;

  effective := public.professional_session_effective_status(session.status, session.opens_at, session.closes_at);
  if effective not in ('ready', 'active')
     or not exists (
       select 1 from public.professional_connections connection
       where connection.id = session.connection_id and connection.status = 'active')
     or (actor = session.professional_user_id and not public.professional_verification_is_current(actor)) then
    perform public.professional_session_event(session, actor, 'CREDENTIAL_REJECTED', 'denied', 'session_closed');
    return 'session_closed';
  end if;

  update public.session_access_credentials credential
    set used_at = statement_timestamp()
    where credential.session_id = session.id
      and credential.participant_user_id = actor
      and p_token is not null and char_length(p_token) between 40 and 64
      and credential.token_digest = public.session_credential_digest(p_token)
      and credential.used_at is null
      and credential.revoked_at is null
      and credential.expires_at > statement_timestamp()
    returning credential.id into credential_id;
  if credential_id is null then
    perform public.professional_session_event(session, actor, 'CREDENTIAL_REJECTED', 'denied', 'credential_invalid');
    return 'credential_invalid';
  end if;

  update public.session_participants participant
    set present = true,
        entered_count = participant.entered_count + 1,
        first_entered_at = coalesce(participant.first_entered_at, statement_timestamp()),
        last_entered_at = statement_timestamp(),
        left_at = null
    where participant.session_id = session.id and participant.user_id = actor;

  if session.status = 'scheduled' then
    update public.professional_sessions
      set status = 'active', started_at = statement_timestamp()
      where id = session.id
      returning * into session;
    perform public.professional_session_event(session, actor, 'SESSION_STARTED', 'success');
  end if;
  perform public.professional_session_event(session, actor, 'SESSION_ENTERED', 'success');
  return 'entered';
end;
$$;

revoke all on function public.enter_professional_session(uuid, text) from public, anon, service_role;
grant execute on function public.enter_professional_session(uuid, text) to authenticated;

create or replace function public.leave_professional_session(p_session_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  session public.professional_sessions%rowtype;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into session from public.professional_sessions s
  where s.id = p_session_id and actor in (s.client_user_id, s.professional_user_id);
  if session.id is null then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  update public.session_participants participant
    set present = false, left_at = statement_timestamp()
    where participant.session_id = session.id and participant.user_id = actor and participant.present;
  update public.session_access_credentials credential
    set revoked_at = statement_timestamp()
    where credential.session_id = session.id and credential.participant_user_id = actor
      and credential.revoked_at is null and credential.used_at is null;
  perform public.professional_session_event(session, actor, 'SESSION_LEFT', 'success');
end;
$$;

revoke all on function public.leave_professional_session(uuid) from public, anon, service_role;
grant execute on function public.leave_professional_session(uuid) to authenticated;

create or replace function public.complete_professional_session(p_session_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  session public.professional_sessions%rowtype;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into session from public.professional_sessions s
  where s.id = p_session_id and s.professional_user_id = actor
  for update;
  if session.id is null then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  if public.professional_session_effective_status(session.status, session.opens_at, session.closes_at) <> 'active' then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  update public.professional_sessions
    set status = 'completed', completed_at = statement_timestamp()
    where id = session.id
    returning * into session;
  update public.session_access_credentials
    set revoked_at = coalesce(revoked_at, statement_timestamp())
    where session_id = session.id;
  update public.session_participants set present = false where session_id = session.id;
  perform public.professional_session_event(session, actor, 'SESSION_COMPLETED', 'success');
end;
$$;

revoke all on function public.complete_professional_session(uuid) from public, anon, service_role;
grant execute on function public.complete_professional_session(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Consentimentos da pessoa
-- ---------------------------------------------------------------------------

/*
  So a pessoa acompanhada muda. Ligar exige sessao que ainda pode acontecer (nao
  cancelada/expirada) e respeita as dependencias; desligar vale sempre, e
  desligar audio derruba transcricao e acesso a transcricao junto (e cada queda
  entra na trilha).
*/
create or replace function public.set_professional_session_consent(
  p_session_id uuid,
  p_consent text,
  p_value boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  session public.professional_sessions%rowtype;
  prior public.professional_sessions%rowtype;
  effective text;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_consent is null or p_value is null or p_consent not in (
    'allow_audio', 'allow_video', 'allow_transcription', 'allow_ai_derivation', 'allow_professional_transcript_access'
  ) then
    raise exception 'invalid_consent' using errcode = '22023';
  end if;
  select * into session from public.professional_sessions s
  where s.id = p_session_id and s.client_user_id = actor
  for update;
  if session.id is null then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  prior := session;
  effective := public.professional_session_effective_status(session.status, session.opens_at, session.closes_at);

  if p_value then
    if effective in ('cancelled', 'expired') then
      raise exception 'session_closed' using errcode = '22023';
    end if;
    if (p_consent = 'allow_transcription' and not session.allow_audio)
       or (p_consent = 'allow_professional_transcript_access' and not session.allow_transcription) then
      raise exception 'consent_dependency' using errcode = '22023';
    end if;
  end if;

  update public.professional_sessions s set
    allow_audio = case when p_consent = 'allow_audio' then p_value else s.allow_audio end,
    allow_video = case when p_consent = 'allow_video' then p_value else s.allow_video end,
    allow_transcription = case
      when p_consent = 'allow_transcription' then p_value
      when p_consent = 'allow_audio' and not p_value then false
      else s.allow_transcription end,
    allow_ai_derivation = case when p_consent = 'allow_ai_derivation' then p_value else s.allow_ai_derivation end,
    allow_professional_transcript_access = case
      when p_consent = 'allow_professional_transcript_access' then p_value
      when p_consent in ('allow_audio', 'allow_transcription') and not p_value then false
      else s.allow_professional_transcript_access end
  where s.id = session.id
  returning * into session;

  if session.allow_audio is distinct from prior.allow_audio then
    perform public.professional_session_event(session, actor, 'CONSENT_CHANGED', 'success',
      'allow_audio:' || case when session.allow_audio then 'on' else 'off' end);
  end if;
  if session.allow_video is distinct from prior.allow_video then
    perform public.professional_session_event(session, actor, 'CONSENT_CHANGED', 'success',
      'allow_video:' || case when session.allow_video then 'on' else 'off' end);
  end if;
  if session.allow_transcription is distinct from prior.allow_transcription then
    perform public.professional_session_event(session, actor, 'CONSENT_CHANGED', 'success',
      'allow_transcription:' || case when session.allow_transcription then 'on' else 'off' end);
  end if;
  if session.allow_ai_derivation is distinct from prior.allow_ai_derivation then
    perform public.professional_session_event(session, actor, 'CONSENT_CHANGED', 'success',
      'allow_ai_derivation:' || case when session.allow_ai_derivation then 'on' else 'off' end);
  end if;
  if session.allow_professional_transcript_access is distinct from prior.allow_professional_transcript_access then
    perform public.professional_session_event(session, actor, 'CONSENT_CHANGED', 'success',
      'allow_professional_transcript_access:' || case when session.allow_professional_transcript_access then 'on' else 'off' end);
  end if;
end;
$$;

revoke all on function public.set_professional_session_consent(uuid, text, boolean) from public, anon, service_role;
grant execute on function public.set_professional_session_consent(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Transcricao para o profissional: so com o consentimento desta sessao
-- ---------------------------------------------------------------------------

/*
  Resultado: ok (com texto) | not_allowed | not_available. Toda tentativa entra
  na trilha da sessao; a leitura com sucesso entra tambem na trilha do titular
  (`professional_access_log`, escopo multimodal_transcript). A sessao nao libera
  resultado de IA, midia nem nada alem desta transcricao.
*/
create or replace function public.get_professional_session_transcript(p_session_id uuid)
returns table (outcome text, content text, word_count integer, transcribed_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  session public.professional_sessions%rowtype;
  transcript record;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into session from public.professional_sessions s
  where s.id = p_session_id and s.professional_user_id = actor;
  if session.id is null then
    return;
  end if;

  if not (session.allow_transcription and session.allow_professional_transcript_access)
     or session.status = 'cancelled'
     or not public.professional_verification_is_current(actor)
     or not exists (
       select 1 from public.professional_connections connection
       where connection.id = session.connection_id and connection.status = 'active') then
    perform public.professional_session_event(session, actor, 'PROFESSIONAL_VIEWED_TRANSCRIPT', 'denied', 'not_allowed');
    return query select 'not_allowed'::text, null::text, null::integer, null::timestamptz;
    return;
  end if;

  select t.content, t.word_count, t.created_at into transcript
  from public.multimodal_sessions capture
  join public.session_transcripts t on t.session_id = capture.id and t.user_id = capture.user_id
  where capture.professional_session_id = session.id
    and capture.user_id = session.client_user_id
    and t.status = 'available'
  order by t.created_at desc
  limit 1;
  if transcript is null then
    perform public.professional_session_event(session, actor, 'PROFESSIONAL_VIEWED_TRANSCRIPT', 'denied', 'not_available');
    return query select 'not_available'::text, null::text, null::integer, null::timestamptz;
    return;
  end if;

  insert into public.professional_access_log (connection_id, client_user_id, professional_user_id, scope)
  values (session.connection_id, session.client_user_id, actor, 'multimodal_transcript');
  perform public.professional_session_event(session, actor, 'PROFESSIONAL_VIEWED_TRANSCRIPT', 'success');
  return query select 'ok'::text, transcript.content, transcript.word_count, transcript.created_at;
end;
$$;

revoke all on function public.get_professional_session_transcript(uuid) from public, anon, service_role;
grant execute on function public.get_professional_session_transcript(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Captura ligada: a arquitetura multimodal existente, sob estes consentimentos
-- ---------------------------------------------------------------------------

alter table public.multimodal_sessions
  add column if not exists professional_session_id uuid
    references public.professional_sessions(id) on delete set null;

create index if not exists multimodal_sessions_professional_session_idx
  on public.multimodal_sessions (professional_session_id)
  where professional_session_id is not null;

create or replace function public.guard_linked_multimodal_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  session public.professional_sessions%rowtype;
begin
  if tg_op = 'UPDATE' and new.professional_session_id is distinct from old.professional_session_id then
    -- `on delete set null` e o unico caminho legitimo de mudanca.
    if not (new.professional_session_id is null and not exists (
      select 1 from public.professional_sessions s where s.id = old.professional_session_id)) then
      raise exception 'linked_session_immutable' using errcode = '42501';
    end if;
  end if;
  if new.professional_session_id is null then
    return new;
  end if;
  select * into session from public.professional_sessions s where s.id = new.professional_session_id;
  if session.id is null or new.user_id <> session.client_user_id then
    raise exception 'linked_session_forbidden' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and public.professional_session_effective_status(session.status, session.opens_at, session.closes_at) <> 'active' then
    raise exception 'linked_session_not_active' using errcode = '22023';
  end if;
  if new.screen_consent
     or (new.camera_consent and not session.allow_video)
     or (new.microphone_consent and not session.allow_audio)
     or (new.transcription_consent and not session.allow_transcription)
     or ((new.ai_analysis_consent or new.visual_analysis_consent) and not session.allow_ai_derivation) then
    if tg_op = 'INSERT'
       or new.screen_consent > old.screen_consent
       or new.camera_consent > old.camera_consent
       or new.microphone_consent > old.microphone_consent
       or new.transcription_consent > old.transcription_consent
       or new.ai_analysis_consent > old.ai_analysis_consent
       or new.visual_analysis_consent > old.visual_analysis_consent then
      raise exception 'linked_session_consent' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_linked_multimodal_session() from public, anon, authenticated, service_role;

create trigger multimodal_sessions_guard_professional_link
before insert or update on public.multimodal_sessions
for each row execute function public.guard_linked_multimodal_session();

/* Revogacao bloqueia nova coleta: cada artefato novo confere o consentimento vigente. */
create or replace function public.guard_linked_capture_artifact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  session public.professional_sessions%rowtype;
  allowed boolean;
begin
  select s.* into session
  from public.multimodal_sessions capture
  join public.professional_sessions s on s.id = capture.professional_session_id
  where capture.id = new.session_id;
  if session.id is null then
    return new;
  end if;
  if tg_table_name = 'media_assets' then
    allowed := case new.media_kind
      when 'camera' then session.allow_video
      when 'microphone' then session.allow_audio
      else false end;
  elsif tg_table_name = 'session_transcripts' then
    allowed := session.allow_transcription or new.status <> 'available';
  else
    allowed := session.allow_ai_derivation;
  end if;
  if not allowed then
    raise exception 'linked_session_consent' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_linked_capture_artifact() from public, anon, authenticated, service_role;

create trigger media_assets_guard_professional_link
before insert on public.media_assets
for each row execute function public.guard_linked_capture_artifact();

create trigger session_transcripts_guard_professional_link
before insert or update of status, content on public.session_transcripts
for each row execute function public.guard_linked_capture_artifact();

create trigger session_interpretations_guard_professional_link
before insert on public.session_interpretations
for each row execute function public.guard_linked_capture_artifact();

create trigger derived_features_guard_professional_link
before insert on public.derived_features
for each row execute function public.guard_linked_capture_artifact();

-- ---------------------------------------------------------------------------
-- 10. Retencao (limpeza; a seguranca nao depende dela)
-- ---------------------------------------------------------------------------

create or replace function public.purge_professional_session_artifacts()
returns table (credentials_deleted integer, events_deleted integer, sessions_expired integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c integer;
  e integer;
  x integer;
begin
  delete from public.session_access_credentials credential
  where coalesce(credential.used_at, credential.revoked_at, credential.expires_at)
        < statement_timestamp() - interval '1 hour';
  get diagnostics c = row_count;
  delete from public.professional_session_events event
  where event.occurred_at < statement_timestamp() - interval '365 days';
  get diagnostics e = row_count;
  with expired as (
    update public.professional_sessions s
      set status = case when s.status = 'active' then 'completed' else 'expired' end,
          completed_at = case when s.status = 'active' then statement_timestamp() else s.completed_at end,
          expired_at = case when s.status = 'scheduled' then statement_timestamp() else s.expired_at end
      where s.status in ('scheduled', 'active') and s.closes_at <= statement_timestamp()
      returning s.id
  )
  select count(*) into x from expired;
  return query select c, e, x;
end;
$$;

revoke all on function public.purge_professional_session_artifacts() from public, anon, authenticated;
grant execute on function public.purge_professional_session_artifacts() to service_role;

-- ---------------------------------------------------------------------------
-- 11. Notificacao session_ready na matriz da Stage 29-C (sem pipeline novo)
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (
  kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice',
           'appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder',
           'session_ready')
);
alter table public.notifications drop constraint notifications_event_key_check;
alter table public.notifications add constraint notifications_event_key_check check (
  event_key ~ '^(checkin_reminder|goal_reminder|system_notice):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or event_key ~ '^weekly_digest:[0-9]{4}-W[0-9]{2}$'
  or event_key ~ '^appointment_(requested|confirmed|cancelled|reminder):[0-9a-f-]{36}$'
  or event_key ~ '^session_ready:[0-9a-f-]{36}$'
);

alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check check (
  kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice',
           'appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder',
           'session_ready')
);

alter table public.email_deliveries drop constraint email_deliveries_kind_check;
alter table public.email_deliveries add constraint email_deliveries_kind_check check (
  kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice',
           'appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder',
           'session_ready')
);
alter table public.email_deliveries drop constraint email_deliveries_event_key_check;
alter table public.email_deliveries add constraint email_deliveries_event_key_check check (
  event_key ~ '^(checkin_reminder|goal_reminder|system_notice):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or event_key ~ '^weekly_digest:[0-9]{4}-W[0-9]{2}$'
  or event_key ~ '^appointment_(requested|confirmed|cancelled|reminder):[0-9a-f-]{36}$'
  or event_key ~ '^session_ready:[0-9a-f-]{36}$'
);

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
    (p_user_id, 'appointment_reminder',  'email', false),
    (p_user_id, 'session_ready', 'in_app', true),
    (p_user_id, 'session_ready', 'web_push', false),
    (p_user_id, 'session_ready', 'email', false)
  on conflict (user_id, kind, channel) do nothing;
end;
$$;

-- Contas existentes ganham as linhas novas (idempotente).
select public.seed_notification_preferences(profile.user_id) from public.profiles profile;

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

  -- PRO-7: sessao aberta para entrada (janela da sessao), uma vez por sessao.
  if public.notification_channel_delivers(current_user_id, 'session_ready', 'in_app') then
    for reminder in
      select session.id from public.professional_sessions session
      where current_user_id in (session.client_user_id, session.professional_user_id)
        and session.status in ('scheduled', 'active')
        and statement_timestamp() >= session.opens_at
        and statement_timestamp() < session.closes_at
    loop
      created_id := null;
      insert into public.notifications (user_id, kind, event_key)
      values (current_user_id, 'session_ready', 'session_ready:' || reminder.id::text)
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
    'appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder',
    'session_ready'
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
