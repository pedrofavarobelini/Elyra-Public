-- Stage 29 / PRO-7R — sessao profissional em tempo real (LiveKit, ADR-0025).
--
-- Aditiva e minima. O provider guarda o estado de midia; a Elyra guarda so o
-- que decide autorizacao e trilha:
--
--   1. `professional_sessions.media_generation` — epoca da midia. O nome da
--      sala e a chave E2EE sao DERIVADOS no servidor a partir de
--      (sessao, geracao) com segredos que nunca entram no banco. Revogacao
--      forte = incrementar a geracao: token antigo aponta para a sala antiga
--      (apagada, e `auto_create = false` no LiveKit impede recria-la) e a
--      chave antiga deixa de ser emitida.
--   2. eventos REALTIME_* na trilha existente (sem midia, sem token, sem chave).
--   3. `authorize_professional_session_media` — o banco refaz TODOS os gates
--      antes de o servidor emitir o token do provider: participante, presenca
--      na sessao (credencial PRO-7 ja trocada), sessao ativa na janela,
--      horario confirmado, vinculo ativo, verificacao vigente.
--
-- Nada de midia, SDP, ICE, token ou chave e persistido.

alter table public.professional_sessions
  add column if not exists media_generation integer not null default 1
    check (media_generation between 1 and 100000);

alter table public.professional_session_events drop constraint professional_session_events_event_check;
alter table public.professional_session_events add constraint professional_session_events_event_check check (event in (
  'SESSION_CREATED', 'SESSION_ENTERED', 'SESSION_LEFT', 'SESSION_STARTED', 'SESSION_COMPLETED',
  'SESSION_CANCELLED', 'SESSION_EXPIRED', 'CONSENT_CHANGED', 'PROFESSIONAL_VIEWED_SESSION_SUMMARY',
  'PROFESSIONAL_VIEWED_TRANSCRIPT', 'CREDENTIAL_ISSUED', 'CREDENTIAL_REJECTED',
  'REALTIME_AUTHORIZED', 'REALTIME_DENIED', 'REALTIME_JOINED', 'REALTIME_LEFT',
  'REALTIME_RECONNECT', 'REALTIME_TERMINATED'
));

alter table public.professional_session_events drop constraint professional_session_events_detail_check;
alter table public.professional_session_events add constraint professional_session_events_detail_check check (
  detail is null
  or detail ~ '^(allow_audio|allow_video|allow_transcription|allow_ai_derivation|allow_professional_transcript_access):(on|off)$'
  or detail in (
    'credential_invalid', 'session_closed', 'not_allowed', 'not_available',
    -- PRO-7R: motivo de recusa/encerramento de midia (vocabulario fechado)
    'not_present', 'relationship_inactive', 'verification_required',
    'session_ended', 'relationship_changed', 'verification_changed'
  )
);

-- ---------------------------------------------------------------------------
-- 1. Revogacao forte: incrementar a epoca da midia
-- ---------------------------------------------------------------------------

create or replace function public.bump_professional_session_media(
  p_session_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  session public.professional_sessions%rowtype;
begin
  update public.professional_sessions
    set media_generation = media_generation + 1
    where id = p_session_id
    returning * into session;
  if session.id is not null then
    perform public.professional_session_event(session, null, 'REALTIME_TERMINATED', 'success', p_reason);
  end if;
end;
$$;

revoke all on function public.bump_professional_session_media(uuid, text) from public, anon, authenticated, service_role;

-- Sessao concluida/cancelada/expirada: a midia acaba junto.
create or replace function public.professional_sessions_bump_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('completed', 'cancelled', 'expired') and old.status is distinct from new.status then
    perform public.bump_professional_session_media(new.id, 'session_ended');
  end if;
  return new;
end;
$$;

revoke all on function public.professional_sessions_bump_on_close() from public, anon, authenticated, service_role;

create trigger professional_sessions_media_on_close
after update of status on public.professional_sessions
for each row execute function public.professional_sessions_bump_on_close();

-- Vinculo pausado/revogado/encerrado: toda sessao ainda aberta perde a midia.
create or replace function public.professional_connections_bump_media()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if old.status = 'active' and new.status in ('paused', 'revoked', 'ended') then
    for target in
      select session.id from public.professional_sessions session
      where session.connection_id = new.id
        and session.status in ('scheduled', 'active')
        and session.closes_at > statement_timestamp()
    loop
      perform public.bump_professional_session_media(target, 'relationship_changed');
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function public.professional_connections_bump_media() from public, anon, authenticated, service_role;

create trigger professional_connections_media_revocation
after update of status on public.professional_connections
for each row execute function public.professional_connections_bump_media();

-- Verificacao suspensa/revogada/rebaixada: idem para as sessoes do profissional.
create or replace function public.professional_profiles_bump_media()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if old.verification_status = 'verified'
     and (new.verification_status <> 'verified'
          or new.verification_review_due_at is distinct from old.verification_review_due_at
             and new.verification_review_due_at <= statement_timestamp()) then
    for target in
      select session.id from public.professional_sessions session
      where session.professional_user_id = new.user_id
        and session.status in ('scheduled', 'active')
        and session.closes_at > statement_timestamp()
    loop
      perform public.bump_professional_session_media(target, 'verification_changed');
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function public.professional_profiles_bump_media() from public, anon, authenticated, service_role;

create trigger professional_profiles_media_revocation
after update of verification_status, verification_review_due_at on public.professional_profiles
for each row execute function public.professional_profiles_bump_media();

-- ---------------------------------------------------------------------------
-- 2. Autorizacao de midia (o banco decide; o servidor so assina o token)
-- ---------------------------------------------------------------------------

/*
  Resultado em linha (nunca raise), para a recusa ficar na trilha:
    authorized | not_found | not_present | session_closed |
    relationship_inactive | verification_required
  `p_purpose`: 'join' (entrada/reconexao: registra REALTIME_AUTHORIZED) ou
  'heartbeat' (revalidacao periodica durante a chamada: so registra recusa).
  Devolve a geracao vigente: o servidor deriva sala e chave dela.
*/
create or replace function public.authorize_professional_session_media(
  p_session_id uuid,
  p_purpose text
)
returns table (outcome text, role text, generation integer, closes_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  actor uuid := auth.uid();
  session public.professional_sessions%rowtype;
  me public.session_participants%rowtype;
  verdict text := 'authorized';
  my_role text;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_purpose is null or p_purpose not in ('join', 'heartbeat') then
    raise exception 'invalid_purpose' using errcode = '22023';
  end if;
  select * into session from public.professional_sessions s
  where s.id = p_session_id and actor in (s.client_user_id, s.professional_user_id);
  if session.id is null then
    return query select 'not_found'::text, null::text, null::integer, null::timestamptz;
    return;
  end if;
  my_role := case when actor = session.professional_user_id then 'professional' else 'client' end;
  select * into me from public.session_participants p where p.session_id = session.id and p.user_id = actor;

  -- 'ready' = janela aberta e ninguem entrou ainda: cai em not_present abaixo
  -- (entrar pela credencial PRO-7 ativa a sessao).
  if public.professional_session_effective_status(session.status, session.opens_at, session.closes_at) not in ('ready', 'active')
     or not exists (
       select 1 from public.appointments appt
       where appt.id = session.appointment_id and appt.status = 'confirmed') then
    verdict := 'session_closed';
  elsif not me.present then
    verdict := 'not_present';
  elsif not exists (
    select 1 from public.professional_connections connection
    where connection.id = session.connection_id and connection.status = 'active') then
    verdict := 'relationship_inactive';
  elsif not public.professional_verification_is_current(session.professional_user_id) then
    verdict := 'verification_required';
  end if;

  if verdict <> 'authorized' then
    perform public.professional_session_event(session, actor, 'REALTIME_DENIED', 'denied', verdict);
  elsif p_purpose = 'join' then
    perform public.professional_session_event(session, actor, 'REALTIME_AUTHORIZED', 'success');
  end if;

  return query select verdict, my_role, session.media_generation, session.closes_at;
end;
$$;

revoke all on function public.authorize_professional_session_media(uuid, text) from public, anon, service_role;
grant execute on function public.authorize_professional_session_media(uuid, text) to authenticated;

/* Eventos de midia relatados pelo cliente do proprio participante (metadado). */
create or replace function public.record_professional_session_media_event(
  p_session_id uuid,
  p_event text
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
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_event is null or p_event not in ('REALTIME_JOINED', 'REALTIME_LEFT', 'REALTIME_RECONNECT') then
    raise exception 'invalid_event' using errcode = '22023';
  end if;
  select * into session from public.professional_sessions s
  where s.id = p_session_id and actor in (s.client_user_id, s.professional_user_id);
  if session.id is null then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  perform public.professional_session_event(session, actor, p_event, 'success');
end;
$$;

revoke all on function public.record_professional_session_media_event(uuid, text) from public, anon, service_role;
grant execute on function public.record_professional_session_media_event(uuid, text) to authenticated;

/*
  Geracao vigente, so para participante e sem efeito colateral: o servidor a
  usa depois de encerrar/cancelar para apagar a sala da geracao anterior na
  hora (a revogacao nao espera o heartbeat).
*/
create or replace function public.professional_session_media_generation(p_session_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select s.media_generation from public.professional_sessions s
  where s.id = p_session_id and auth.uid() in (s.client_user_id, s.professional_user_id);
$$;

revoke all on function public.professional_session_media_generation(uuid) from public, anon, service_role;
grant execute on function public.professional_session_media_generation(uuid) to authenticated;
