-- Stage 29 / PRO-7 — sessoes profissionais protegidas.
--
-- Matriz USER A / PRO A (X) / USER B / PRO B (Y) / ANON / SERVICE ROLE, IDOR por
-- UUID, credencial efemera adversarial, consentimentos independentes com
-- dependencia, politica de artefato (revogar bloqueia nova coleta), leitura de
-- transcricao pelo profissional so com consentimento da sessao, ciclo de vida
-- (cancelamento, conclusao, janela) e notificacao session_ready.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(70);

-- Fixtures -------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('29700000-0000-4000-8000-000000000001', 'pro7-a@elyra.invalid', now(), '{"display_name":"Pessoa A"}'),
  ('29700000-0000-4000-8000-000000000002', 'pro7-b@elyra.invalid', now(), '{"display_name":"Pessoa B"}'),
  ('29700000-0000-4000-8000-000000000011', 'pro7-x@elyra.invalid', now(), '{"display_name":"Pro X"}'),
  ('29700000-0000-4000-8000-000000000012', 'pro7-y@elyra.invalid', now(), '{"display_name":"Pro Y"}');

insert into public.professional_profiles (user_id, council_region, registration_number, specialty,
  verification_status, verification_reviewed_at, verification_review_due_at)
values
  ('29700000-0000-4000-8000-000000000011', '06', 'P7-X', 'Psicologia', 'verified', now() - interval '1 day', now() + interval '300 days'),
  ('29700000-0000-4000-8000-000000000012', '06', 'P7-Y', 'Psicologia', 'verified', now() - interval '1 day', now() + interval '300 days');

insert into public.professional_connections (id, client_user_id, professional_user_id, invited_by_user_id, status, accepted_at) values
  ('29700000-0000-4000-8000-0000000000c1', '29700000-0000-4000-8000-000000000001', '29700000-0000-4000-8000-000000000011', '29700000-0000-4000-8000-000000000001', 'active', now() - interval '2 days'),
  ('29700000-0000-4000-8000-0000000000c2', '29700000-0000-4000-8000-000000000002', '29700000-0000-4000-8000-000000000012', '29700000-0000-4000-8000-000000000002', 'active', now() - interval '2 days');

-- A captura so com o modulo de sessoes pessoal ligado (regra existente da Stage 11).
update public.user_preferences set sessions_enabled = true
where user_id in ('29700000-0000-4000-8000-000000000001', '29700000-0000-4000-8000-000000000002');

-- a1: A-X agora (janela aberta). a2: A-X daqui a 3 h (janela fechada). a3: B-Y agora.
insert into public.appointments (id, connection_id, client_user_id, professional_user_id, starts_at, ends_at,
  timezone, modality, status, requested_by, idempotency_key, confirmed_at) values
  ('29700000-0000-4000-8000-0000000000a1', '29700000-0000-4000-8000-0000000000c1', '29700000-0000-4000-8000-000000000001', '29700000-0000-4000-8000-000000000011',
   now() + interval '5 minutes', now() + interval '55 minutes', 'America/Sao_Paulo', 'online', 'confirmed', '29700000-0000-4000-8000-000000000001', gen_random_uuid(), now()),
  ('29700000-0000-4000-8000-0000000000a2', '29700000-0000-4000-8000-0000000000c1', '29700000-0000-4000-8000-000000000001', '29700000-0000-4000-8000-000000000011',
   now() + interval '3 hours', now() + interval '4 hours', 'America/Sao_Paulo', 'online', 'confirmed', '29700000-0000-4000-8000-000000000001', gen_random_uuid(), now()),
  ('29700000-0000-4000-8000-0000000000a3', '29700000-0000-4000-8000-0000000000c2', '29700000-0000-4000-8000-000000000002', '29700000-0000-4000-8000-000000000012',
   now() + interval '5 minutes', now() + interval '55 minutes', 'America/Sao_Paulo', 'online', 'confirmed', '29700000-0000-4000-8000-000000000002', gen_random_uuid(), now());

create temp table ids (name text primary key, id uuid, token text);
insert into ids select 's1', id, null from public.professional_sessions where appointment_id = '29700000-0000-4000-8000-0000000000a1';
insert into ids select 's2', id, null from public.professional_sessions where appointment_id = '29700000-0000-4000-8000-0000000000a2';
insert into ids select 's3', id, null from public.professional_sessions where appointment_id = '29700000-0000-4000-8000-0000000000a3';
grant all on ids to authenticated, anon, service_role;

create or replace function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end;
$$;

-- 1. Estrutura -----------------------------------------------------------------

select is((select count(*)::int from ids where id is not null), 3, 'confirmar cria uma sessao por appointment');
select is((select count(*)::int from public.session_participants where session_id = (select id from ids where name = 's1')), 2,
  'exatamente dois participantes: a pessoa e o profissional do appointment');
select hasnt_column('public', 'session_access_credentials', 'token', 'credencial nao tem coluna de texto claro');
select ok((select relforcerowsecurity from pg_class where oid = 'public.professional_sessions'::regclass), 'RLS forcada em professional_sessions');
select ok(not has_table_privilege('authenticated', 'public.session_access_credentials', 'select'), 'authenticated nao le credenciais');
select ok(not has_table_privilege('service_role', 'public.session_access_credentials', 'select'), 'service_role nao le credenciais');
select ok(not has_table_privilege('authenticated', 'public.professional_sessions', 'update'), 'sem UPDATE direto de sessao');
select ok(not has_table_privilege('anon', 'public.professional_sessions', 'select'), 'anon nao le sessao');
update public.appointments set status = 'confirmed' where id = '29700000-0000-4000-8000-0000000000a1';
select is((select count(*)::int from public.professional_sessions where appointment_id = '29700000-0000-4000-8000-0000000000a1'), 1,
  'reconfirmar e idempotente: continua uma sessao');

-- 2. Leitura e IDOR ---------------------------------------------------------------

select pg_temp.as_user('29700000-0000-4000-8000-000000000001');
select is((select status from public.get_professional_session((select id from ids where name = 's1'))), 'ready', 'A: janela aberta = ready');
select is((select status from public.get_professional_session((select id from ids where name = 's2'))), 'scheduled', 'A: daqui a 3 h = scheduled');
select is((select count(*)::int from public.get_professional_session((select id from ids where name = 's3'))), 0, 'A nao le a sessao de B por UUID');
select is((select count(*)::int from public.professional_sessions), 2, 'RLS: A ve so as proprias sessoes');
select ok((select not (allow_audio or allow_video or allow_transcription or allow_ai_derivation or allow_professional_transcript_access)
  from public.get_professional_session((select id from ids where name = 's1'))), 'todos os consentimentos nascem desligados');
select pg_temp.as_user('29700000-0000-4000-8000-000000000012');
select is((select count(*)::int from public.get_professional_session((select id from ids where name = 's1'))), 0, 'PRO B nao le a sessao de A/X');
select is((select count(*)::int from public.session_participants where session_id = (select id from ids where name = 's1')), 0, 'PRO B nao le participantes de A/X');
select pg_temp.as_user('29700000-0000-4000-8000-000000000011');
select is((select role from public.get_professional_session((select id from ids where name = 's1'))), 'professional', 'X le a propria sessao');
reset role;
select is((select count(*)::int from public.professional_session_events
  where session_id = (select id from ids where name = 's1') and event = 'PROFESSIONAL_VIEWED_SESSION_SUMMARY'), 1,
  'leitura do profissional entra na trilha, sem conteudo');
reset role;
set local role anon;
select throws_ok($$ select * from public.get_professional_session((select id from ids where name = 's1')) $$, '42501', null, 'anon nao executa');
reset role;
set local role service_role;
select is((select count(*)::int from public.professional_sessions where id = (select id from ids where name = 's1')), 1, 'service_role le (export/QA)');
select throws_ok($$ insert into public.professional_sessions (appointment_id, connection_id, client_user_id, professional_user_id, opens_at, closes_at)
  values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), now(), now() + interval '1 hour') $$,
  '42501', null, 'service_role nao cria sessao (sem bypass de produto)');
select throws_ok($$ select count(*) from public.session_access_credentials $$, '42501', null, 'service_role nao le digest de credencial');
reset role;

select pg_temp.as_user('29700000-0000-4000-8000-000000000001');
select lives_ok($$ select public.materialize_in_app_notifications() $$, 'A materializa com a janela aberta');
reset role;
select is((select count(*)::int from public.notifications where user_id = '29700000-0000-4000-8000-000000000001'
  and event_key = 'session_ready:' || (select id from ids where name = 's1')), 1, 'janela aberta: session_ready uma vez');

-- 3. Credencial efemera -----------------------------------------------------------

select pg_temp.as_user('29700000-0000-4000-8000-000000000001');
update ids set token = public.issue_professional_session_credential(id) where name = 's1';
select ok((select char_length(token) = 43 and token ~ '^[A-Za-z0-9_-]+$' from ids where name = 's1'), 'token de 32 bytes em base64url');
select throws_ok($$ select public.issue_professional_session_credential((select id from ids where name = 's2')) $$,
  '22023', 'session_closed', 'fora da janela: sem credencial');
select throws_ok($$ select public.issue_professional_session_credential((select id from ids where name = 's3')) $$,
  'P0002', 'session_not_found', 'A nao emite credencial para a sessao de B');
select is(public.enter_professional_session((select id from ids where name = 's1'), 'x' || (select token from ids where name = 's1')),
  'credential_invalid', 'token adulterado: recusado');
select is(public.enter_professional_session((select id from ids where name = 's1'), null), 'credential_invalid', 'sem token: recusado');
reset role;
select pg_temp.as_user('29700000-0000-4000-8000-000000000011');
select is(public.enter_professional_session((select id from ids where name = 's1'), (select token from ids where name = 's1')),
  'credential_invalid', 'token da pessoa nao serve ao profissional (vinculado ao participante)');
reset role;
select pg_temp.as_user('29700000-0000-4000-8000-000000000002');
select is(public.enter_professional_session((select id from ids where name = 's1'), (select token from ids where name = 's1')),
  'not_found', 'token roubado por outra conta: sessao nem existe para ela');
reset role;
select pg_temp.as_user('29700000-0000-4000-8000-000000000001');
select is(public.enter_professional_session((select id from ids where name = 's1'), (select token from ids where name = 's1')),
  'entered', 'A entra com o proprio token');
select is(public.enter_professional_session((select id from ids where name = 's1'), (select token from ids where name = 's1')),
  'credential_invalid', 'replay do mesmo token: recusado (uso unico)');
select is((select status from public.get_professional_session((select id from ids where name = 's1'))), 'active', 'primeira entrada ativa a sessao');
select ok((select me_present from public.get_professional_session((select id from ids where name = 's1'))), 'A presente');
-- Emitir de novo revoga a anterior nao usada.
update ids set token = public.issue_professional_session_credential(id) where name = 's1';
select lives_ok($$ select public.issue_professional_session_credential((select id from ids where name = 's1')) $$, 'nova emissao');
select is(public.enter_professional_session((select id from ids where name = 's1'), (select token from ids where name = 's1')),
  'credential_invalid', 'emitir outra revoga a anterior');
reset role;
select is((select count(*)::int from public.session_access_credentials c, ids
  where ids.name = 's1' and c.token_digest = public.session_credential_digest(ids.token)), 1,
  'banco guarda so o digest do token emitido');
update public.session_access_credentials set issued_at = now() - interval '5 minutes', expires_at = now() - interval '4 minutes'
where session_id = (select id from ids where name = 's1') and revoked_at is null and used_at is null;
select pg_temp.as_user('29700000-0000-4000-8000-000000000001');
select throws_ok($$ select public.issue_professional_session_credential((select id from ids where name = 's1'))
  from generate_series(1, 6) $$, '54000', 'rate_limited', 'limite de emissao por participante');
reset role;
select ok((select count(*) > 0 from public.professional_session_events
  where session_id = (select id from ids where name = 's1') and event = 'CREDENTIAL_REJECTED' and result = 'denied'),
  'recusas de credencial ficam na trilha');

-- 4. Consentimentos ------------------------------------------------------------------

select pg_temp.as_user('29700000-0000-4000-8000-000000000011');
select throws_ok($$ select public.set_professional_session_consent((select id from ids where name = 's1'), 'allow_audio', true) $$,
  'P0002', 'session_not_found', 'o profissional nao muda consentimento da pessoa');
reset role;
select pg_temp.as_user('29700000-0000-4000-8000-000000000001');
select throws_ok($$ select public.set_professional_session_consent((select id from ids where name = 's1'), 'allow_transcription', true) $$,
  '22023', 'consent_dependency', 'transcricao exige audio');
select throws_ok($$ select public.set_professional_session_consent((select id from ids where name = 's1'), 'allow_everything', true) $$,
  '22023', 'invalid_consent', 'consentimento fora do vocabulario');

-- 5. Captura ligada sob os consentimentos --------------------------------------------

select throws_ok($$ insert into public.multimodal_sessions (user_id, kind, microphone_consent, professional_session_id)
  values ('29700000-0000-4000-8000-000000000001', 'free', true, (select id from ids where name = 's1')) $$,
  '42501', 'linked_session_consent', 'microfone sem allow_audio: recusado');
select lives_ok($$ select public.set_professional_session_consent((select id from ids where name = 's1'), 'allow_audio', true) $$, 'A liga audio');
select lives_ok($$ select public.set_professional_session_consent((select id from ids where name = 's1'), 'allow_transcription', true) $$, 'A liga transcricao');
select throws_ok($$ insert into public.multimodal_sessions (user_id, kind, screen_consent, microphone_consent, professional_session_id)
  values ('29700000-0000-4000-8000-000000000001', 'free', true, true, (select id from ids where name = 's1')) $$,
  '42501', 'linked_session_consent', 'tela nunca entra na sessao profissional');
select throws_ok($$ insert into public.multimodal_sessions (user_id, kind, camera_consent, professional_session_id)
  values ('29700000-0000-4000-8000-000000000001', 'free', true, (select id from ids where name = 's1')) $$,
  '42501', 'linked_session_consent', 'camera sem allow_video: recusado');
insert into public.multimodal_sessions (id, user_id, kind, microphone_consent, transcription_consent, professional_session_id)
values ('29700000-0000-4000-8000-0000000000f1', '29700000-0000-4000-8000-000000000001', 'free', true, true, (select id from ids where name = 's1'));
select pass('captura ligada com microfone + transcricao consentidos');
select throws_ok($$ insert into public.multimodal_sessions (user_id, kind, microphone_consent, professional_session_id)
  values ('29700000-0000-4000-8000-000000000001', 'free', true, (select id from ids where name = 's2')) $$,
  '22023', 'linked_session_not_active', 'captura so com a sessao ativa');
select throws_ok($$ update public.multimodal_sessions set professional_session_id = (select id from ids where name = 's2')
  where id = '29700000-0000-4000-8000-0000000000f1' $$, '42501', 'linked_session_immutable', 'vinculo da captura e imutavel');
reset role;
select pg_temp.as_user('29700000-0000-4000-8000-000000000002');
select throws_ok($$ insert into public.multimodal_sessions (user_id, kind, microphone_consent, professional_session_id)
  values ('29700000-0000-4000-8000-000000000002', 'free', true, (select id from ids where name = 's1')) $$,
  '42501', 'linked_session_forbidden', 'B nao liga captura a sessao de A');
reset role;

insert into public.session_transcripts (session_id, user_id, status, content, word_count, voiced_duration_ms)
values ('29700000-0000-4000-8000-0000000000f1', '29700000-0000-4000-8000-000000000001', 'available',
        'texto sintetico de teste', 4, 3000);
select pass('transcricao com allow_transcription ligado');

-- 6. Transcricao para o profissional -------------------------------------------------

select pg_temp.as_user('29700000-0000-4000-8000-000000000011');
select is((select outcome from public.get_professional_session_transcript((select id from ids where name = 's1'))), 'not_allowed',
  'transcrever NAO autoriza o profissional a ler');
reset role;
select pg_temp.as_user('29700000-0000-4000-8000-000000000001');
select lives_ok($$ select public.set_professional_session_consent((select id from ids where name = 's1'), 'allow_professional_transcript_access', true) $$,
  'A libera a transcricao desta sessao');
select is((select count(*)::int from public.get_professional_session_transcript((select id from ids where name = 's1'))), 0,
  'a pessoa nao usa a leitura do profissional');
reset role;
select pg_temp.as_user('29700000-0000-4000-8000-000000000011');
select is((select outcome || ':' || content from public.get_professional_session_transcript((select id from ids where name = 's1'))),
  'ok:texto sintetico de teste', 'com consentimento da sessao, X le');
reset role;
select is((select count(*)::int from public.professional_access_log
  where client_user_id = '29700000-0000-4000-8000-000000000001' and scope = 'multimodal_transcript'), 1,
  'leitura entra na trilha do titular');
select pg_temp.as_user('29700000-0000-4000-8000-000000000012');
select is((select count(*)::int from public.get_professional_session_transcript((select id from ids where name = 's1'))), 0,
  'PRO B nao le transcricao de A por UUID');
reset role;
select pg_temp.as_user('29700000-0000-4000-8000-000000000001');
select lives_ok($$ select public.set_professional_session_consent((select id from ids where name = 's1'), 'allow_audio', false) $$,
  'A desliga audio');
select ok((select not allow_transcription and not allow_professional_transcript_access
  from public.get_professional_session((select id from ids where name = 's1'))), 'desligar audio derruba transcricao e acesso');
reset role;
select pg_temp.as_user('29700000-0000-4000-8000-000000000011');
select is((select outcome from public.get_professional_session_transcript((select id from ids where name = 's1'))), 'not_allowed',
  'revogacao bloqueia a proxima leitura, na hora');
reset role;
select throws_ok($$ insert into public.media_assets (session_id, user_id, media_kind, storage_path, mime_type, size_bytes)
  values ('29700000-0000-4000-8000-0000000000f1', '29700000-0000-4000-8000-000000000001', 'microphone',
          '29700000-0000-4000-8000-000000000001/multimodal/29700000-0000-4000-8000-0000000000f1/x.webm', 'audio/webm', 10) $$,
  '42501', 'linked_session_consent', 'audio revogado: nova midia recusada');
select is((select count(*)::int from public.session_transcripts where session_id = '29700000-0000-4000-8000-0000000000f1'), 1,
  'o que ja existe continua da pessoa (nada apagado em silencio)');
select is((select count(*)::int from public.professional_session_events
  where session_id = (select id from ids where name = 's1') and event = 'CONSENT_CHANGED'), 6,
  'cada mudanca de consentimento (inclusive as quedas em cascata) na trilha');

-- 7. Ciclo de vida -----------------------------------------------------------------------

select pg_temp.as_user('29700000-0000-4000-8000-000000000011');
select lives_ok($$ select public.complete_professional_session((select id from ids where name = 's1')) $$, 'X encerra');
reset role;
select pg_temp.as_user('29700000-0000-4000-8000-000000000001');
select throws_ok($$ select public.issue_professional_session_credential((select id from ids where name = 's1')) $$,
  '22023', 'session_closed', 'concluida: reentrada recusada');
reset role;
update public.appointments set status = 'cancelled', cancelled_at = now(), cancelled_by = '29700000-0000-4000-8000-000000000002',
  cancel_reason = 'schedule_change' where id = '29700000-0000-4000-8000-0000000000a3';
select is((select status from public.professional_sessions where id = (select id from ids where name = 's3')), 'cancelled',
  'appointment cancelado cancela a sessao');
select pg_temp.as_user('29700000-0000-4000-8000-000000000001');
select lives_ok($$ select public.materialize_in_app_notifications() $$, 'A materializa avisos');
reset role;
select is((select count(*)::int from public.notifications where user_id = '29700000-0000-4000-8000-000000000001'
  and event_key = 'session_ready:' || (select id from ids where name = 's2')), 0, 'sessao fora da janela: sem session_ready');

select * from finish();
rollback;
