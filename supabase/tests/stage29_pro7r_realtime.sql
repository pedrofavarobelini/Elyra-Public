-- Stage 29 / PRO-7R — autorizacao de midia em tempo real e revogacao forte.
--
-- Matriz USER A / PRO X / USER B / PRO Y / ANON / SERVICE ROLE sobre
-- `authorize_professional_session_media`, geracao da midia (epoca) incrementada
-- por conclusao, cancelamento, pausa/fim do vinculo e verificacao suspensa,
-- eventos REALTIME_* so com metadado e vocabulario fechado.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(48);

-- Fixtures -------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('29710000-0000-4000-8000-000000000001', 'pro7r-a@elyra.invalid', now(), '{"display_name":"Pessoa A"}'),
  ('29710000-0000-4000-8000-000000000002', 'pro7r-b@elyra.invalid', now(), '{"display_name":"Pessoa B"}'),
  ('29710000-0000-4000-8000-000000000011', 'pro7r-x@elyra.invalid', now(), '{"display_name":"Pro X"}'),
  ('29710000-0000-4000-8000-000000000012', 'pro7r-y@elyra.invalid', now(), '{"display_name":"Pro Y"}');

insert into public.professional_profiles (user_id, council_region, registration_number, specialty,
  verification_status, verification_reviewed_at, verification_review_due_at)
values
  ('29710000-0000-4000-8000-000000000011', '06', 'P7R-X', 'Psicologia', 'verified', now() - interval '1 day', now() + interval '300 days'),
  ('29710000-0000-4000-8000-000000000012', '06', 'P7R-Y', 'Psicologia', 'verified', now() - interval '1 day', now() + interval '300 days');

insert into public.professional_connections (id, client_user_id, professional_user_id, invited_by_user_id, status, accepted_at) values
  ('29710000-0000-4000-8000-0000000000c1', '29710000-0000-4000-8000-000000000001', '29710000-0000-4000-8000-000000000011', '29710000-0000-4000-8000-000000000001', 'active', now() - interval '2 days'),
  ('29710000-0000-4000-8000-0000000000c2', '29710000-0000-4000-8000-000000000002', '29710000-0000-4000-8000-000000000012', '29710000-0000-4000-8000-000000000002', 'active', now() - interval '2 days');

-- a1: A-X agora. a2: A-X daqui a 3 h. a3: B-Y agora.
insert into public.appointments (id, connection_id, client_user_id, professional_user_id, starts_at, ends_at,
  timezone, modality, status, requested_by, idempotency_key, confirmed_at) values
  ('29710000-0000-4000-8000-0000000000a1', '29710000-0000-4000-8000-0000000000c1', '29710000-0000-4000-8000-000000000001', '29710000-0000-4000-8000-000000000011',
   now() + interval '5 minutes', now() + interval '55 minutes', 'America/Sao_Paulo', 'online', 'confirmed', '29710000-0000-4000-8000-000000000001', gen_random_uuid(), now()),
  ('29710000-0000-4000-8000-0000000000a2', '29710000-0000-4000-8000-0000000000c1', '29710000-0000-4000-8000-000000000001', '29710000-0000-4000-8000-000000000011',
   now() + interval '3 hours', now() + interval '4 hours', 'America/Sao_Paulo', 'online', 'confirmed', '29710000-0000-4000-8000-000000000001', gen_random_uuid(), now()),
  ('29710000-0000-4000-8000-0000000000a3', '29710000-0000-4000-8000-0000000000c2', '29710000-0000-4000-8000-000000000002', '29710000-0000-4000-8000-000000000012',
   now() + interval '5 minutes', now() + interval '55 minutes', 'America/Sao_Paulo', 'online', 'confirmed', '29710000-0000-4000-8000-000000000002', gen_random_uuid(), now());

create temp table ids (name text primary key, id uuid);
insert into ids select 's1', id from public.professional_sessions where appointment_id = '29710000-0000-4000-8000-0000000000a1';
insert into ids select 's2', id from public.professional_sessions where appointment_id = '29710000-0000-4000-8000-0000000000a2';
insert into ids select 's3', id from public.professional_sessions where appointment_id = '29710000-0000-4000-8000-0000000000a3';
grant all on ids to authenticated, anon, service_role;

create or replace function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.enter(p_session uuid) returns text language plpgsql as $$
begin
  return public.enter_professional_session(p_session, public.issue_professional_session_credential(p_session));
end;
$$;

create or replace function pg_temp.gen(p_name text) returns integer language sql as $$
  select media_generation from public.professional_sessions where id = (select id from ids where name = p_name);
$$;

create or replace function pg_temp.authz(p_name text, p_purpose text) returns text language sql as $$
  select outcome || ':' || coalesce(role, '-') from public.authorize_professional_session_media((select id from ids where name = p_name), p_purpose);
$$;

-- 1. Estrutura ------------------------------------------------------------------

select has_column('public', 'professional_sessions', 'media_generation', 'epoca da midia existe');
select is(pg_temp.gen('s1'), 1, 'geracao nasce em 1');
select hasnt_column('public', 'professional_sessions', 'media_room', 'nome da sala nao e persistido (derivado no servidor)');
select hasnt_column('public', 'professional_sessions', 'e2ee_key', 'chave E2EE nunca e persistida');
select ok(not has_function_privilege('authenticated', 'public.bump_professional_session_media(uuid, text)', 'execute'),
  'authenticated nao incrementa a geracao diretamente');
select ok(not has_function_privilege('anon', 'public.authorize_professional_session_media(uuid, text)', 'execute'),
  'anon nao executa a autorizacao');
select ok(not has_function_privilege('service_role', 'public.authorize_professional_session_media(uuid, text)', 'execute'),
  'service_role nao executa a autorizacao (sem bypass de produto)');
select ok(not has_function_privilege('anon', 'public.record_professional_session_media_event(uuid, text)', 'execute'),
  'anon nao registra evento de midia');

-- 2. Recusas antes de entrar ------------------------------------------------------

select pg_temp.as_user('29710000-0000-4000-8000-000000000001');
select is(pg_temp.authz('s1', 'join'), 'not_present:client', 'A sem entrar na sessao (credencial PRO-7): sem midia');
select is(pg_temp.authz('s2', 'join'), 'session_closed:client', 'fora da janela: sem midia');
select is(pg_temp.authz('s3', 'join'), 'not_found:-', 'A nao autoriza midia da sessao de B por UUID');
select is((select outcome from public.authorize_professional_session_media(gen_random_uuid(), 'join')), 'not_found',
  'UUID inexistente: not_found (sem enumeracao)');
select throws_ok($$ select * from public.authorize_professional_session_media((select id from ids where name = 's1'), 'publish') $$,
  '22023', 'invalid_purpose', 'proposito fora do vocabulario');
reset role;

set local role anon;
select throws_ok($$ select * from public.authorize_professional_session_media((select id from ids where name = 's1'), 'join') $$,
  '42501', null, 'anon: permissao negada');
reset role;
set local role service_role;
select throws_ok($$ select * from public.authorize_professional_session_media((select id from ids where name = 's1'), 'join') $$,
  '42501', null, 'service_role: permissao negada');
reset role;

-- 3. Autorizado ----------------------------------------------------------------------

select pg_temp.as_user('29710000-0000-4000-8000-000000000001');
select is(pg_temp.enter((select id from ids where name = 's1')), 'entered', 'A entra (PRO-7)');
select is(pg_temp.authz('s1', 'join'), 'authorized:client', 'A autorizada para a midia');
select is((select generation from public.authorize_professional_session_media((select id from ids where name = 's1'), 'heartbeat')), 1,
  'heartbeat devolve a geracao vigente');
reset role;
select pg_temp.as_user('29710000-0000-4000-8000-000000000011');
select is(pg_temp.authz('s1', 'join'), 'not_present:professional', 'X ainda nao entrou');
select is(pg_temp.enter((select id from ids where name = 's1')), 'entered', 'X entra (PRO-7)');
select is(pg_temp.authz('s1', 'join'), 'authorized:professional', 'X autorizado');
reset role;
select pg_temp.as_user('29710000-0000-4000-8000-000000000012');
select is(pg_temp.authz('s1', 'join'), 'not_found:-', 'PRO Y nao autoriza midia de A/X');
select throws_ok($$ select public.record_professional_session_media_event((select id from ids where name = 's1'), 'REALTIME_JOINED') $$,
  'P0002', 'session_not_found', 'PRO Y nao registra evento na sessao de A/X');
reset role;
select pg_temp.as_user('29710000-0000-4000-8000-000000000002');
select is(pg_temp.authz('s1', 'heartbeat'), 'not_found:-', 'USER B nao autoriza midia de A/X');
reset role;

select is((select count(*)::int from public.professional_session_events
  where session_id = (select id from ids where name = 's1') and event = 'REALTIME_AUTHORIZED'), 2,
  'join autorizado na trilha (heartbeat autorizado nao polui)');
select ok((select count(*) > 0 from public.professional_session_events
  where session_id = (select id from ids where name = 's1') and event = 'REALTIME_DENIED' and detail = 'not_present'),
  'recusa na trilha com motivo fechado');

-- 4. Eventos relatados pelo cliente ------------------------------------------------------

select pg_temp.as_user('29710000-0000-4000-8000-000000000001');
select lives_ok($$ select public.record_professional_session_media_event((select id from ids where name = 's1'), 'REALTIME_JOINED') $$,
  'A registra entrada na chamada');
select throws_ok($$ select public.record_professional_session_media_event((select id from ids where name = 's1'), 'REALTIME_TERMINATED') $$,
  '22023', 'invalid_event', 'cliente nao forja encerramento');
select throws_ok($$ select public.record_professional_session_media_event((select id from ids where name = 's1'), 'SESSION_COMPLETED') $$,
  '22023', 'invalid_event', 'cliente nao forja evento de ciclo de vida');
reset role;
select throws_ok($$ insert into public.professional_session_events (session_id, subject_user_id, actor_user_id, connection_id, event, result, detail)
  select id, '29710000-0000-4000-8000-000000000001', '29710000-0000-4000-8000-000000000001', '29710000-0000-4000-8000-0000000000c1', 'REALTIME_JOINED', 'success', 'token=abc'
  from ids where name = 's1' $$, '23514', null, 'detalhe fora do vocabulario (ex.: token) e recusado pelo CHECK');

-- 5. Revogacao forte: vinculo pausado ------------------------------------------------------

update public.professional_connections set status = 'paused', paused_at = now() where id = '29710000-0000-4000-8000-0000000000c1';
select is(pg_temp.gen('s1'), 2, 'pausar o vinculo incrementa a geracao da sessao aberta');
select is(pg_temp.gen('s2'), 2, 'e de toda sessao futura ainda aberta do vinculo');
select is(pg_temp.gen('s3'), 1, 'sessao de outro vinculo intacta');
select pg_temp.as_user('29710000-0000-4000-8000-000000000001');
select is(pg_temp.authz('s1', 'heartbeat'), 'relationship_inactive:client', 'heartbeat recusa com vinculo pausado');
reset role;
select ok((select count(*) = 1 from public.professional_session_events
  where session_id = (select id from ids where name = 's1') and event = 'REALTIME_TERMINATED' and detail = 'relationship_changed'),
  'encerramento da midia na trilha, com motivo');
update public.professional_connections set status = 'active', paused_at = null where id = '29710000-0000-4000-8000-0000000000c1';
select is(pg_temp.gen('s1'), 2, 'retomar NAO volta a geracao antiga (token antigo continua morto)');
select pg_temp.as_user('29710000-0000-4000-8000-000000000001');
select is(pg_temp.authz('s1', 'join'), 'authorized:client', 'retomado: nova autorizacao na geracao nova');
reset role;

-- 6. Revogacao forte: verificacao suspensa ----------------------------------------------------

update public.professional_profiles set verification_status = 'suspended'
where user_id = '29710000-0000-4000-8000-000000000011';
select is(pg_temp.gen('s1'), 3, 'suspender a verificacao incrementa a geracao');
select pg_temp.as_user('29710000-0000-4000-8000-000000000011');
select is(pg_temp.authz('s1', 'heartbeat'), 'verification_required:professional', 'profissional suspenso: sem midia');
reset role;
update public.professional_profiles set verification_status = 'verified'
where user_id = '29710000-0000-4000-8000-000000000011';
update public.professional_profiles set verification_review_due_at = now() - interval '1 minute'
where user_id = '29710000-0000-4000-8000-000000000011';
select is(pg_temp.gen('s1'), 4, 'revisao vencida (prazo movido ao passado) incrementa a geracao');
select pg_temp.as_user('29710000-0000-4000-8000-000000000001');
select is(pg_temp.authz('s1', 'heartbeat'), 'verification_required:client', 'a pessoa tambem perde a midia');
reset role;
update public.professional_profiles set verification_review_due_at = now() + interval '300 days'
where user_id = '29710000-0000-4000-8000-000000000011';

-- 7. Revogacao forte: cancelamento e conclusao ------------------------------------------------

update public.appointments set status = 'cancelled', cancelled_at = now(), cancelled_by = '29710000-0000-4000-8000-000000000002',
  cancel_reason = 'schedule_change' where id = '29710000-0000-4000-8000-0000000000a3';
select is(pg_temp.gen('s3'), 2, 'appointment cancelado: sessao cancelada e midia encerrada');
select pg_temp.as_user('29710000-0000-4000-8000-000000000011');
select lives_ok($$ select public.complete_professional_session((select id from ids where name = 's1')) $$, 'X encerra a sessao');
reset role;
select is(pg_temp.gen('s1'), 5, 'concluir incrementa a geracao');
select pg_temp.as_user('29710000-0000-4000-8000-000000000001');
select is(pg_temp.authz('s1', 'join'), 'session_closed:client', 'concluida: sem midia, sem reentrada');
select is(public.professional_session_media_generation((select id from ids where name = 's1')), 5, 'participante le a geracao vigente');
select is(public.professional_session_media_generation((select id from ids where name = 's3')), null, 'nao participante: nada');
reset role;
select ok(not has_function_privilege('anon', 'public.professional_session_media_generation(uuid)', 'execute'), 'anon nao le geracao');

select * from finish();
rollback;
