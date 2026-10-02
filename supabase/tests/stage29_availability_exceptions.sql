-- Stage 29 / UX F6 - excecoes de agenda, provadas por comportamento.
--
-- horarios = (regra semanal UNIAO aberturas) MENOS bloqueios. Bloquear nao
-- cancela horario pedido ou confirmado: vira conflito listado (D-UX-5).
--
-- Atores: X e Y profissionais verificados, Z pendente; A com vinculo ativo com
-- X; B com vinculo ativo com Y. Regra semanal de X: so no dia da semana de D1,
-- 09:00-12:00, 60 min, online, America/Sao_Paulo. D1/D2 = hoje+3/hoje+4 (local).

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(49);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
       email, null, timezone('utc', now()), '', '', '', '', '', '', '', '',
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', name),
       timezone('utc', now()), timezone('utc', now())
from (values
  ('29f60000-0000-4000-8000-000000000001'::uuid, 'uxf6-a@elyra.invalid', 'Titular A'),
  ('29f60000-0000-4000-8000-000000000002'::uuid, 'uxf6-b@elyra.invalid', 'Titular B'),
  ('29f60000-0000-4000-8000-000000000011'::uuid, 'uxf6-x@elyra.invalid', 'Profissional X'),
  ('29f60000-0000-4000-8000-000000000012'::uuid, 'uxf6-y@elyra.invalid', 'Profissional Y'),
  ('29f60000-0000-4000-8000-000000000013'::uuid, 'uxf6-z@elyra.invalid', 'Profissional Z')
) as fixture(id, email, name);

insert into public.professional_profiles (
  user_id, council_region, registration_number, specialty, verification_status,
  verification_reviewed_at, verification_review_due_at
) values
  ('29f60000-0000-4000-8000-000000000011', '06', '06/f60011', 'Psicologia', 'verified',
   timezone('utc', now()), timezone('utc', now()) + interval '365 days'),
  ('29f60000-0000-4000-8000-000000000012', '06', '06/f60012', 'Psicologia', 'verified',
   timezone('utc', now()), timezone('utc', now()) + interval '365 days'),
  ('29f60000-0000-4000-8000-000000000013', '06', '06/f60013', 'Psicologia', 'pending', null, null);

insert into public.professional_connections (
  id, client_user_id, professional_user_id, invited_by_user_id, status, accepted_at
) values
  ('29f60000-0000-4000-8000-0000000000c1', '29f60000-0000-4000-8000-000000000001',
   '29f60000-0000-4000-8000-000000000011', '29f60000-0000-4000-8000-000000000011', 'active', now()),
  ('29f60000-0000-4000-8000-0000000000c2', '29f60000-0000-4000-8000-000000000002',
   '29f60000-0000-4000-8000-000000000012', '29f60000-0000-4000-8000-000000000012', 'active', now());

create temporary table d (name text primary key, day date, ts timestamptz, id uuid) on commit drop;
insert into d (name, day) values
  ('today', (now() at time zone 'America/Sao_Paulo')::date),
  ('d1', (now() at time zone 'America/Sao_Paulo')::date + 3),
  ('d2', (now() at time zone 'America/Sao_Paulo')::date + 4);
insert into d (name, ts) values
  ('d1_09', ((select day from d where name = 'd1') + time '09:00') at time zone 'America/Sao_Paulo'),
  ('d2_14', ((select day from d where name = 'd2') + time '14:00') at time zone 'America/Sao_Paulo'),
  ('d2_15', ((select day from d where name = 'd2') + time '15:00') at time zone 'America/Sao_Paulo'),
  ('d8_09', ((select day from d where name = 'd1') + 7 + time '09:00') at time zone 'America/Sao_Paulo');
grant all on d to authenticated;

create function pg_temp.as_user(p_id text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end;
$$;

create function pg_temp.ex(p_kind text, p_starts date, p_ends date, p_start int, p_end int, p_slot int, p_modality text)
returns jsonb language sql as $$
  select jsonb_build_object(
    'kind', p_kind, 'starts_on', p_starts, 'ends_on', p_ends,
    'start_minute', p_start, 'end_minute', p_end, 'slot_minutes', p_slot, 'modality', p_modality
  );
$$;
grant execute on function pg_temp.ex(text, date, date, int, int, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Estrutura, RLS e privilegios
-- ---------------------------------------------------------------------------

select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid = 'public.professional_availability_exceptions'::regclass), 'excecoes com RLS forcada');
select ok(
  not has_table_privilege('authenticated', 'public.professional_availability_exceptions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.professional_availability_exceptions', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.professional_availability_exceptions', 'DELETE'),
  'nenhuma escrita direta: so por RPC');
select ok(not has_table_privilege('anon', 'public.professional_availability_exceptions', 'SELECT'), 'anon nao le excecoes');
select ok(not has_function_privilege('anon', 'public.save_professional_availability_exception(text, jsonb)', 'EXECUTE'),
  'anon nao salva excecao');
select ok(not has_function_privilege('authenticated', 'public.availability_window_overlaps(date, date, integer, integer, text, timestamptz, timestamptz)', 'EXECUTE'),
  'helper interno nao e exposto');
select ok(not has_function_privilege('authenticated', 'public.professional_slot_offer(uuid, timestamptz, text)', 'EXECUTE'),
  'oferta continua interna');

-- ---------------------------------------------------------------------------
-- 2. Horario de verao: dia inteiro local de 25 h (America/New_York, 01/11/2026)
-- ---------------------------------------------------------------------------

select ok(public.availability_window_overlaps('2026-11-01', '2026-11-01', null, null, 'America/New_York',
  '2026-11-02 04:30+00', '2026-11-02 04:45+00'), 'dia de 25 h: 23:30 local ainda e o dia bloqueado');
select ok(not public.availability_window_overlaps('2026-11-01', '2026-11-01', null, null, 'America/New_York',
  '2026-11-02 05:00+00', '2026-11-02 06:00+00'), 'meia-noite local do dia seguinte ja esta livre');
select ok(public.availability_window_overlaps('2026-03-08', '2026-03-08', 180, 240, 'America/New_York',
  '2026-03-08 07:00+00', '2026-03-08 07:30+00'), 'faixa 03:00-04:00 no dia de 23 h cai em 07:00Z');

-- ---------------------------------------------------------------------------
-- 3. Validacao
-- ---------------------------------------------------------------------------

select pg_temp.as_user('29f60000-0000-4000-8000-000000000013');
select throws_ok(
  $$ select public.save_professional_availability_exception('America/Sao_Paulo',
       pg_temp.ex('block', (select day from d where name='d1'), (select day from d where name='d1'), null, null, null, null)) $$,
  '42501', 'verification_required', 'profissional nao verificado nao cria excecao');

select pg_temp.as_user('29f60000-0000-4000-8000-000000000011');
select lives_ok(
  $$ select public.save_professional_availability('America/Sao_Paulo', jsonb_build_array(jsonb_build_object(
       'weekday', extract(dow from (select day from d where name='d1'))::int,
       'start_minute', 540, 'end_minute', 720, 'slot_minutes', 60, 'modality', 'online'))) $$,
  'X publica a regra semanal do dia de D1');
select throws_ok(
  $$ select public.save_professional_availability_exception('Etc/GMT+3',
       pg_temp.ex('block', (select day from d where name='d1'), (select day from d where name='d1'), null, null, null, null)) $$,
  '22023', 'invalid_timezone', 'fuso offset e recusado');
select throws_ok(
  $$ select public.save_professional_availability_exception('America/Sao_Paulo',
       pg_temp.ex('block', (select day from d where name='d1'), (select day from d where name='d1'), null, null, null, null)
       || '{"note":"ferias"}') $$,
  '22023', 'invalid_exception', 'chave fora do contrato (texto livre) e recusada');
select throws_ok(
  $$ select public.save_professional_availability_exception('America/Sao_Paulo',
       pg_temp.ex('block', (select day - 1 from d where name='today'), (select day from d where name='today'), null, null, null, null)) $$,
  '22023', 'invalid_exception', 'excecao no passado e recusada');
select throws_ok(
  $$ select public.save_professional_availability_exception('America/Sao_Paulo',
       pg_temp.ex('open', (select day from d where name='d2'), (select day from d where name='d2'), 840, 960, null, 'online')) $$,
  '22023', 'invalid_exception', 'abertura sem duracao e recusada');
select throws_ok(
  $$ select public.save_professional_availability_exception('America/Sao_Paulo',
       pg_temp.ex('open', (select day from d where name='d2'), (select day from d where name='d2'), null, null, 60, 'online')) $$,
  '22023', 'invalid_exception', 'abertura de dia inteiro e recusada');
select throws_ok(
  $$ select public.save_professional_availability_exception('America/Sao_Paulo',
       pg_temp.ex('block', (select day from d where name='d2'), (select day from d where name='d2'), 840, 960, 60, null)) $$,
  '22023', 'invalid_exception', 'bloqueio nao tem duracao de horario');
select throws_ok(
  $$ select public.save_professional_availability_exception('America/Sao_Paulo',
       pg_temp.ex('open', (select day + 61 from d where name='today'), (select day + 61 from d where name='today'), 840, 960, 60, 'online')) $$,
  '22023', 'exception_outside_window', 'abertura alem do horizonte de 60 dias e recusada');
select throws_ok(
  $$ select public.save_professional_availability_exception('America/Sao_Paulo',
       pg_temp.ex('block', (select day from d where name='d1'), (select day + 367 from d where name='today'), null, null, null, null)) $$,
  '22023', 'exception_outside_window', 'bloqueio alem de um ano e recusado');
-- ADR-0035: finite fixture replaces recurring offer, without deleting legacy.
reset role;
insert into public.professional_availability_exceptions
 (professional_user_id,kind,starts_on,ends_on,start_minute,end_minute,slot_minutes,timezone,modality)
select '29f60000-0000-4000-8000-000000000011','open',day,day,540,720,60,'America/Sao_Paulo','online'
from d where name='d1';
select pg_temp.as_user('29f60000-0000-4000-8000-000000000011');
select throws_ok(
 $$ select public.save_professional_availability_exception('America/Sao_Paulo',
 pg_temp.ex('open',(select day from d where name='d1'),(select day from d where name='d1'),600,660,60,'online')) $$,
 '22023','exception_overlap','abertura sobre outra abertura finita e recusada');

-- ---------------------------------------------------------------------------
-- 4. Abertura fora da regra semanal
-- ---------------------------------------------------------------------------

update d set id = public.save_professional_availability_exception('America/Sao_Paulo',
  pg_temp.ex('open', (select day from d where name='d2'), (select day from d where name='d2'), 840, 960, 60, 'online'))
where name = 'd2';
select isnt((select id from d where name = 'd2'), null, 'X abre 14:00-16:00 em D2 (dia sem regra)');
select throws_ok(
  $$ select public.save_professional_availability_exception('America/Sao_Paulo',
       pg_temp.ex('open', (select day from d where name='d2'), (select day from d where name='d2'), 900, 1020, 60, 'online')) $$,
  '22023', 'exception_overlap', 'abertura sobreposta a outra abertura e recusada');
select is((select count(*)::int from public.professional_availability_exceptions), 2, 'X le as proprias aberturas finitas');
select is(
  (select count(*)::int from public.audit_logs
    where actor_user_id = '29f60000-0000-4000-8000-000000000011' and action = 'scheduling.availability_exception_saved'),
  1, 'salvar deixa trilha sem conteudo');

select pg_temp.as_user('29f60000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.professional_availability_exceptions), 0, 'A nao le excecoes de X (RLS)');
select ok(exists (
  select 1 from public.list_professional_open_slots('29f60000-0000-4000-8000-000000000011',
    (select ts from d where name='d2_14') - interval '1 hour', (select ts from d where name='d2_15') + interval '2 hours')
  where starts_at = (select ts from d where name='d2_14')
), 'A ve 14:00 de D2 aberto pela excecao');
select is((
  select count(*)::int from public.list_professional_open_slots('29f60000-0000-4000-8000-000000000011',
    (select ts from d where name='d2_14') - interval '1 hour', (select ts from d where name='d2_15') + interval '2 hours')
), 2, 'D2 oferece exatamente 14:00 e 15:00');
select is((
  select count(*)::int from public.list_professional_open_slots('29f60000-0000-4000-8000-000000000011',
    (select ts from d where name='d1_09') - interval '1 hour', (select ts from d where name='d1_09') + interval '4 hours')
), 3, 'antes do bloqueio D1 oferece 09:00, 10:00 e 11:00 pela regra semanal');
update d set id = public.request_appointment('29f60000-0000-4000-8000-0000000000c1',
  (select ts from d where name='d2_14'), 'online', gen_random_uuid())
where name = 'd2_14';
select isnt((select id from d where name = 'd2_14'), null, 'A pede o horario aberto pela excecao');
select throws_ok(
  $$ select public.request_appointment('29f60000-0000-4000-8000-0000000000c1',
       (select ts from d where name='d2_14') + interval '30 minutes', 'online', gen_random_uuid()) $$,
  '22023', 'slot_not_offered', 'fora da grade da abertura continua recusado');

-- ---------------------------------------------------------------------------
-- 5. Bloqueio dentro da regra e sobre a abertura; conflito nao cancela
-- ---------------------------------------------------------------------------

select pg_temp.as_user('29f60000-0000-4000-8000-000000000011');
select lives_ok($$ select public.confirm_appointment((select id from d where name='d2_14')) $$,
  'X confirma o horario de D2 14:00');
update d set id = public.save_professional_availability_exception('America/Sao_Paulo',
  pg_temp.ex('block', (select day from d where name='d1'), (select day from d where name='d1'), null, null, null, null))
where name = 'd1';
update d set id = public.save_professional_availability_exception('America/Sao_Paulo',
  pg_temp.ex('block', (select day from d where name='d2'), (select day from d where name='d2'), 840, 960, null, null))
where name = 'd2_15';
select is(
  (select count(*)::int from public.list_my_availability_conflicts()
    where appointment_id = (select id from d where name='d2_14') and status = 'confirmed'),
  1, 'bloqueio sobre horario confirmado aparece como conflito');
select is((select status from public.appointments where id = (select id from d where name='d2_14')), 'confirmed',
  'bloquear NAO cancela o horario confirmado');

select pg_temp.as_user('29f60000-0000-4000-8000-000000000001');
select is((
  select count(*)::int from public.list_professional_open_slots('29f60000-0000-4000-8000-000000000011',
    (select ts from d where name='d1_09') - interval '1 hour', (select ts from d where name='d1_09') + interval '4 hours')
), 0, 'dia bloqueado: a regra semanal nao oferece nada em D1');
select throws_ok(
  $$ select public.request_appointment('29f60000-0000-4000-8000-0000000000c1',
       (select ts from d where name='d1_09'), 'online', gen_random_uuid()) $$,
  '22023', 'slot_not_offered', 'pedido em dia bloqueado e recusado');
select is((
  select count(*)::int from public.list_professional_open_slots('29f60000-0000-4000-8000-000000000011',
    (select ts from d where name='d2_14') - interval '1 hour', (select ts from d where name='d2_15') + interval '2 hours')
), 0, 'bloqueio vence a abertura: 15:00 de D2 some');
select ok(not exists (
  select 1 from public.list_professional_open_slots('29f60000-0000-4000-8000-000000000011',
    (select ts from d where name='d8_09') - interval '1 hour', (select ts from d where name='d8_09') + interval '4 hours')
  where starts_at = (select ts from d where name='d8_09')
), 'sem publicacao finita, legacy nao oferece na semana seguinte');
select is((select count(*)::int from public.list_my_availability_conflicts()), 0, 'A nao ve conflitos de X');

-- ---------------------------------------------------------------------------
-- 6. Remover: so o dono; a oferta volta
-- ---------------------------------------------------------------------------

select pg_temp.as_user('29f60000-0000-4000-8000-000000000012');
select throws_ok($$ select public.delete_professional_availability_exception((select id from d where name='d2_15')) $$,
  'P0002', 'exception_not_found', 'Y nao remove excecao de X');

select pg_temp.as_user('29f60000-0000-4000-8000-000000000011');
select lives_ok($$ select public.delete_professional_availability_exception((select id from d where name='d2_15')) $$,
  'X remove o bloqueio de D2');
select is((select count(*)::int from public.list_my_availability_conflicts()), 0, 'sem bloqueio, sem conflito');

select pg_temp.as_user('29f60000-0000-4000-8000-000000000001');
select ok(exists (
  select 1 from public.list_professional_open_slots('29f60000-0000-4000-8000-000000000011',
    (select ts from d where name='d2_14') - interval '1 hour', (select ts from d where name='d2_15') + interval '2 hours')
  where starts_at = (select ts from d where name='d2_15')
), '15:00 de D2 volta a ser oferecido');

-- ---------------------------------------------------------------------------
-- 7. Ferias (periodo) e "tem horarios"
-- ---------------------------------------------------------------------------

select pg_temp.as_user('29f60000-0000-4000-8000-000000000011');
select lives_ok(
  $$ select public.save_professional_availability_exception('America/Sao_Paulo',
       pg_temp.ex('block', (select day from d where name='d1'), (select day + 8 from d where name='d1'), null, null, null, null)) $$,
  'X bloqueia um periodo (ferias)');
select pg_temp.as_user('29f60000-0000-4000-8000-000000000001');
select is((
  select count(*)::int from public.list_professional_open_slots('29f60000-0000-4000-8000-000000000011',
    (select ts from d where name='d8_09') - interval '1 hour', (select ts from d where name='d8_09') + interval '4 hours')
), 0, 'ferias tiram a regra semanal da semana seguinte');

select pg_temp.as_user('29f60000-0000-4000-8000-000000000002');
select is((select has_availability from public.list_my_scheduling_professionals() limit 1), false,
  'Y sem regra nem abertura: sem horarios');
select pg_temp.as_user('29f60000-0000-4000-8000-000000000012');
select lives_ok(
  $$ select public.save_professional_availability_exception('America/Sao_Paulo',
       pg_temp.ex('open', (select day from d where name='d2'), (select day from d where name='d2'), 600, 720, 60, 'online')) $$,
  'Y so tem uma abertura avulsa');
select pg_temp.as_user('29f60000-0000-4000-8000-000000000002');
select is((select has_availability from public.list_my_scheduling_professionals() limit 1), true,
  'abertura avulsa conta como agenda publicada');

-- ---------------------------------------------------------------------------
-- 8. Remocao registrada; regra semanal inalterada
-- ---------------------------------------------------------------------------

reset role;
select is(
  (select count(*)::int from public.audit_logs
    where actor_user_id = '29f60000-0000-4000-8000-000000000011' and action = 'scheduling.availability_exception_removed'),
  1, 'remover deixa trilha sem conteudo');
select is(
  (select count(*)::int from public.professional_availability_rules
    where professional_user_id = '29f60000-0000-4000-8000-000000000011'),
  1, 'o modelo semanal nao foi tocado pelas excecoes');

select * from finish();
rollback;
