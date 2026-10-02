-- Stage 29 / PRO-6 - agenda, provada por comportamento.
--
-- Atores: X e Y profissionais verificados, Z pendente; A e D com vinculo ativo
-- com X; B com vinculo ativo com Y; C com vinculo PAUSADO com X; A tambem com
-- vinculo ativo com Z (nao verificado). Disponibilidade de X: todos os dias,
-- 00:00-24:00, horarios de 60 min, America/Sao_Paulo.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(77);

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
  ('29600000-0000-4000-8000-000000000001'::uuid, 'pro6-a@elyra.invalid', 'Titular A'),
  ('29600000-0000-4000-8000-000000000002'::uuid, 'pro6-b@elyra.invalid', 'Titular B'),
  ('29600000-0000-4000-8000-000000000003'::uuid, 'pro6-c@elyra.invalid', 'Titular C'),
  ('29600000-0000-4000-8000-000000000004'::uuid, 'pro6-d@elyra.invalid', 'Titular D'),
  ('29600000-0000-4000-8000-000000000011'::uuid, 'pro6-x@elyra.invalid', 'Profissional X'),
  ('29600000-0000-4000-8000-000000000012'::uuid, 'pro6-y@elyra.invalid', 'Profissional Y'),
  ('29600000-0000-4000-8000-000000000013'::uuid, 'pro6-z@elyra.invalid', 'Profissional Z')
) as fixture(id, email, name);

insert into public.professional_profiles (
  user_id, council_region, registration_number, specialty, verification_status,
  verification_reviewed_at, verification_review_due_at
) values
  ('29600000-0000-4000-8000-000000000011', '06', '06/600011', 'Psicologia', 'verified',
   timezone('utc', now()), timezone('utc', now()) + interval '365 days'),
  ('29600000-0000-4000-8000-000000000012', '06', '06/600012', 'Psicologia', 'verified',
   timezone('utc', now()), timezone('utc', now()) + interval '365 days'),
  ('29600000-0000-4000-8000-000000000013', '06', '06/600013', 'Psicologia', 'pending', null, null);

insert into public.professional_connections (
  id, client_user_id, professional_user_id, invited_by_user_id, status, accepted_at, paused_at
) values
  ('29600000-0000-4000-8000-0000000000c1', '29600000-0000-4000-8000-000000000001',
   '29600000-0000-4000-8000-000000000011', '29600000-0000-4000-8000-000000000011', 'active', now(), null),
  ('29600000-0000-4000-8000-0000000000c2', '29600000-0000-4000-8000-000000000002',
   '29600000-0000-4000-8000-000000000012', '29600000-0000-4000-8000-000000000012', 'active', now(), null),
  ('29600000-0000-4000-8000-0000000000c3', '29600000-0000-4000-8000-000000000003',
   '29600000-0000-4000-8000-000000000011', '29600000-0000-4000-8000-000000000011', 'paused', now(), now()),
  ('29600000-0000-4000-8000-0000000000c4', '29600000-0000-4000-8000-000000000004',
   '29600000-0000-4000-8000-000000000011', '29600000-0000-4000-8000-000000000011', 'active', now(), null),
  ('29600000-0000-4000-8000-0000000000c5', '29600000-0000-4000-8000-000000000001',
   '29600000-0000-4000-8000-000000000013', '29600000-0000-4000-8000-000000000013', 'active', now(), null),
  ('29600000-0000-4000-8000-0000000000c6', '29600000-0000-4000-8000-000000000001',
   '29600000-0000-4000-8000-000000000012', '29600000-0000-4000-8000-000000000012', 'active', now(), null);

-- Horario-alvo: hora cheia daqui a 3 h (hora cheia UTC = hora cheia em Sao Paulo).
create temporary table t (name text primary key, ts timestamptz, id uuid) on commit drop;
insert into t (name, ts) values
  ('s1', date_trunc('hour', now()) + interval '3 hours'),
  ('s2', date_trunc('hour', now()) + interval '5 hours');
grant all on t to authenticated;

create function pg_temp.as_user(p_id text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Estrutura, RLS e privilegios
-- ---------------------------------------------------------------------------

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.appointments'::regclass),
  'appointments com RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.professional_availability_rules'::regclass),
  'regras de disponibilidade com RLS forcada');
select ok(
  not has_table_privilege('authenticated', 'public.appointments', 'INSERT')
  and not has_table_privilege('authenticated', 'public.appointments', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.appointments', 'DELETE'),
  'nenhuma escrita direta em appointments: so transicao por RPC');
select ok(
  not has_table_privilege('authenticated', 'public.professional_availability_rules', 'INSERT')
  and not has_table_privilege('authenticated', 'public.professional_availability_rules', 'DELETE'),
  'nenhuma escrita direta nas regras');
select ok(not has_table_privilege('anon', 'public.appointments', 'SELECT'), 'anon nao le appointments');
select ok(not has_function_privilege('anon', 'public.request_appointment(uuid, timestamptz, text, uuid)', 'EXECUTE'),
  'anon nao pede horario');

-- ---------------------------------------------------------------------------
-- 2. Fuso IANA de regiao
-- ---------------------------------------------------------------------------

select ok(public.scheduling_timezone_is_valid('America/Sao_Paulo'), 'America/Sao_Paulo e fuso valido');
select ok(public.scheduling_timezone_is_valid('America/Argentina/Buenos_Aires'), 'fuso com dois niveis e valido');
select ok(not public.scheduling_timezone_is_valid('UTC'), 'UTC nao e lugar');
select ok(not public.scheduling_timezone_is_valid('Etc/GMT+3'), 'offset fixo Etc/ e recusado');
select ok(not public.scheduling_timezone_is_valid('-03:00'), 'offset literal e recusado');
select ok(not public.scheduling_timezone_is_valid('America/Nao_Existe'), 'nome inexistente e recusado');

-- ---------------------------------------------------------------------------
-- 3. Disponibilidade
-- ---------------------------------------------------------------------------

select pg_temp.as_user('29600000-0000-4000-8000-000000000013');
select throws_ok(
  $$ select public.save_professional_availability('America/Sao_Paulo', '[{"weekday":1,"start_minute":540,"end_minute":720,"slot_minutes":60,"modality":"online"}]') $$,
  '42501', 'verification_required', 'profissional nao verificado nao publica agenda');

select pg_temp.as_user('29600000-0000-4000-8000-000000000011');
select throws_ok(
  $$ select public.save_professional_availability('Etc/GMT+3', '[]') $$,
  '22023', 'invalid_timezone', 'fuso de offset recusado na gravacao');
select throws_ok(
  $$ select public.save_professional_availability('America/Sao_Paulo', '[{"weekday":1,"start_minute":540,"end_minute":720,"slot_minutes":60,"modality":"online"},{"weekday":1,"start_minute":660,"end_minute":780,"slot_minutes":60,"modality":"online"}]') $$,
  '22023', 'overlapping_rules', 'faixas sobrepostas no mesmo dia recusadas');
select throws_ok(
  $$ select public.save_professional_availability('America/Sao_Paulo', '[{"weekday":9,"start_minute":540,"end_minute":720,"slot_minutes":60,"modality":"online"}]') $$,
  '22023', 'invalid_rules', 'dia inexistente recusado');
select throws_ok(
  $$ select public.save_professional_availability('America/Sao_Paulo', '[{"weekday":1,"start_minute":540,"end_minute":720,"slot_minutes":60,"modality":"online","preco":100}]') $$,
  '22023', 'invalid_rules', 'campo fora do contrato (preco) recusado');
select is(
  public.save_professional_availability('America/Sao_Paulo',
    (select jsonb_agg(jsonb_build_object('weekday', d, 'start_minute', 0, 'end_minute', 1440, 'slot_minutes', 60, 'modality', 'online'))
     from generate_series(0, 6) d)),
  7, 'X publica 7 regras');
select is((select count(*)::int from public.professional_availability_rules), 7, 'X le as proprias regras');

select pg_temp.as_user('29600000-0000-4000-8000-000000000012');
select is((select count(*)::int from public.professional_availability_rules), 0, 'Y nao le regras de X');
select is(public.save_professional_availability('America/Sao_Paulo',
  '[{"weekday":0,"start_minute":0,"end_minute":1440,"slot_minutes":60,"modality":"online"},{"weekday":1,"start_minute":0,"end_minute":1440,"slot_minutes":60,"modality":"online"},{"weekday":2,"start_minute":0,"end_minute":1440,"slot_minutes":60,"modality":"online"},{"weekday":3,"start_minute":0,"end_minute":1440,"slot_minutes":60,"modality":"online"},{"weekday":4,"start_minute":0,"end_minute":1440,"slot_minutes":60,"modality":"online"},{"weekday":5,"start_minute":0,"end_minute":1440,"slot_minutes":60,"modality":"online"},{"weekday":6,"start_minute":0,"end_minute":1440,"slot_minutes":60,"modality":"online"}]'),
  7, 'Y publica a propria agenda');

-- ---------------------------------------------------------------------------
-- 4. Horarios livres: so para o profissional ou vinculo ativo
-- ---------------------------------------------------------------------------

-- ADR-0035: the preceding RPC tests exercise inactive templates. Offers
-- below use finite dates; appointment and notification assertions stay.
reset role;
insert into public.professional_availability_exceptions
  (professional_user_id,kind,starts_on,ends_on,start_minute,end_minute,slot_minutes,timezone,modality)
select id,'open',(now() at time zone 'America/Sao_Paulo')::date,
  (now() at time zone 'America/Sao_Paulo')::date+59,0,1440,60,'America/Sao_Paulo','online'
from (values ('29600000-0000-4000-8000-000000000011'::uuid),('29600000-0000-4000-8000-000000000012'::uuid)) f(id);

select pg_temp.as_user('29600000-0000-4000-8000-000000000001');
select ok(
  (select count(*) from public.list_professional_open_slots('29600000-0000-4000-8000-000000000011', now(), now() + interval '2 days')) > 0,
  'A (vinculo ativo com X) ve horarios de X');
select ok(
  (select bool_and(starts_at >= now() + interval '60 minutes') from public.list_professional_open_slots('29600000-0000-4000-8000-000000000011', now(), now() + interval '2 days')),
  'nenhum horario com menos de 60 min de antecedencia');
select pg_temp.as_user('29600000-0000-4000-8000-000000000002');
select is(
  (select count(*)::int from public.list_professional_open_slots('29600000-0000-4000-8000-000000000011', now(), now() + interval '2 days')),
  0, 'B (sem vinculo com X) recebe zero horarios, nao erro');
select pg_temp.as_user('29600000-0000-4000-8000-000000000003');
select is(
  (select count(*)::int from public.list_professional_open_slots('29600000-0000-4000-8000-000000000011', now(), now() + interval '2 days')),
  0, 'C (vinculo pausado) nao ve horarios');
select throws_ok(
  $$ select * from public.list_professional_open_slots('29600000-0000-4000-8000-000000000011', now(), now() + interval '40 days') $$,
  '22023', 'invalid_range', 'intervalo acima de 31 dias recusado');

-- ---------------------------------------------------------------------------
-- 5. Pedir horario: servidor decide
-- ---------------------------------------------------------------------------

select pg_temp.as_user('29600000-0000-4000-8000-000000000001');
update t set id = public.request_appointment('29600000-0000-4000-8000-0000000000c1',
  (select ts from t where name = 's1'), 'online', '29600000-0000-4000-8000-00000000aa01')
where name = 's1';
select isnt((select id from t where name = 's1'), null, 'A pede o horario s1 com X');
select is(
  public.request_appointment('29600000-0000-4000-8000-0000000000c1', (select ts from t where name = 's1'), 'online', '29600000-0000-4000-8000-00000000aa01'),
  (select id from t where name = 's1'),
  'replay com a mesma chave devolve o MESMO pedido');
select throws_ok(
  format($$ select public.request_appointment('29600000-0000-4000-8000-0000000000c1', %L, 'online', '29600000-0000-4000-8000-00000000aa01') $$, (select ts from t where name = 's2')),
  '22023', 'idempotency_mismatch', 'mesma chave com outro horario e recusada');
select is((select count(*)::int from public.appointments where client_user_id = auth.uid()), 1, 'um pedido logico apos replay');
select throws_ok(
  format($$ select public.request_appointment('29600000-0000-4000-8000-0000000000c1', %L, 'online', gen_random_uuid()) $$, (select ts from t where name = 's2') + interval '30 minutes'),
  '22023', 'slot_not_offered', 'horario adulterado fora da grade recusado');
select throws_ok(
  format($$ select public.request_appointment('29600000-0000-4000-8000-0000000000c1', %L, 'in_person', gen_random_uuid()) $$, (select ts from t where name = 's2')),
  '22023', 'slot_not_offered', 'modalidade nao oferecida recusada');
select throws_ok(
  $$ select public.request_appointment('29600000-0000-4000-8000-0000000000c1', date_trunc('hour', now()) - interval '2 hours', 'online', gen_random_uuid()) $$,
  '22023', 'outside_window', 'passado recusado');
select throws_ok(
  format($$ select public.request_appointment('29600000-0000-4000-8000-0000000000c5', %L, 'online', gen_random_uuid()) $$, (select ts from t where name = 's2')),
  '42501', 'professional_unavailable', 'profissional nao verificado nao recebe pedido');
select throws_ok(
  format($$ select public.request_appointment('29600000-0000-4000-8000-0000000000c2', %L, 'online', gen_random_uuid()) $$, (select ts from t where name = 's2')),
  'P0002', 'relationship_not_found', 'vinculo de outra pessoa nao serve');
-- Conflito da propria pessoa: A ja tem s1 com X; pedir s1 com Y colide.
select throws_ok(
  format($$ select public.request_appointment('29600000-0000-4000-8000-0000000000c6', %L, 'online', gen_random_uuid()) $$, (select ts from t where name = 's1')),
  '23P01', 'slot_unavailable', 'a pessoa nao fica em dois horarios ao mesmo tempo');

select pg_temp.as_user('29600000-0000-4000-8000-000000000003');
select throws_ok(
  format($$ select public.request_appointment('29600000-0000-4000-8000-0000000000c3', %L, 'online', gen_random_uuid()) $$, (select ts from t where name = 's2')),
  '42501', 'relationship_inactive', 'vinculo pausado nao pede horario');

-- Dupla reserva: D disputa o mesmo horario de X.
select pg_temp.as_user('29600000-0000-4000-8000-000000000004');
select throws_ok(
  format($$ select public.request_appointment('29600000-0000-4000-8000-0000000000c4', %L, 'online', gen_random_uuid()) $$, (select ts from t where name = 's1')),
  '23P01', 'slot_unavailable', 'DUPLA RESERVA: segundo pedido do mesmo horario recusado');
select is(
  (select count(*)::int from public.list_professional_open_slots('29600000-0000-4000-8000-000000000011', (select ts from t where name = 's1'), (select ts from t where name = 's1') + interval '1 hour')),
  0, 'horario ocupado some da lista para os outros');

-- A barreira e do banco, e nao so da RPC.
reset role;
select throws_ok(
  format($$ insert into public.appointments (connection_id, client_user_id, professional_user_id, starts_at, ends_at, timezone, modality, requested_by, idempotency_key)
            values ('29600000-0000-4000-8000-0000000000c4', '29600000-0000-4000-8000-000000000004', '29600000-0000-4000-8000-000000000011', %L, %L, 'America/Sao_Paulo', 'online', '29600000-0000-4000-8000-000000000004', gen_random_uuid()) $$,
         (select ts from t where name = 's1') + interval '30 minutes', (select ts from t where name = 's1') + interval '90 minutes'),
  '23P01', null, 'exclusion constraint barra sobreposicao parcial mesmo por INSERT direto');

select is(
  (select count(*)::int from public.notifications where user_id = '29600000-0000-4000-8000-000000000011' and kind = 'appointment_requested'),
  1, 'X recebeu aviso in-app do pedido (uma vez)');

-- ---------------------------------------------------------------------------
-- 6. RLS de leitura
-- ---------------------------------------------------------------------------

select pg_temp.as_user('29600000-0000-4000-8000-000000000011');
select is((select count(*)::int from public.appointments), 1, 'X ve o pedido dele');
select is((select counterpart_name from public.list_my_appointments(null) limit 1), 'Titular A', 'X ve o nome da pessoa');
select pg_temp.as_user('29600000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.appointments), 0, 'B nao ve horario de A');
select pg_temp.as_user('29600000-0000-4000-8000-000000000012');
select is((select count(*)::int from public.appointments), 0, 'Y nao ve horario de X');
select pg_temp.as_user('29600000-0000-4000-8000-000000000001');
select is((select counterpart_name from public.list_my_appointments(null) limit 1), 'Profissional X', 'A ve o nome do profissional pela projecao');
select throws_ok(
  format($$ update public.appointments set status = 'confirmed', confirmed_at = now() where id = %L $$, (select id from t where name = 's1')),
  '42501', null, 'A nao confirma o proprio pedido por UPDATE direto');

-- ---------------------------------------------------------------------------
-- 7. Transicoes
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$ select public.confirm_appointment(%L) $$, (select id from t where name = 's1')),
  'P0002', 'appointment_not_found', 'a pessoa nao confirma');
select pg_temp.as_user('29600000-0000-4000-8000-000000000012');
select throws_ok(
  format($$ select public.confirm_appointment(%L) $$, (select id from t where name = 's1')),
  'P0002', 'appointment_not_found', 'outro profissional nao confirma');
select pg_temp.as_user('29600000-0000-4000-8000-000000000011');
select lives_ok(format($$ select public.confirm_appointment(%L) $$, (select id from t where name = 's1')), 'X confirma');
select throws_ok(
  format($$ select public.confirm_appointment(%L) $$, (select id from t where name = 's1')),
  '22023', 'invalid_transition', 'confirmar duas vezes e transicao invalida');
select throws_ok(
  format($$ select public.close_appointment(%L, 'completed') $$, (select id from t where name = 's1')),
  '22023', 'appointment_not_started', 'nao se conclui horario futuro');

select pg_temp.as_user('29600000-0000-4000-8000-000000000002');
select throws_ok(
  format($$ select public.cancel_appointment(%L, 'other') $$, (select id from t where name = 's1')),
  'P0002', 'appointment_not_found', 'cancelamento cruzado recusado');
select pg_temp.as_user('29600000-0000-4000-8000-000000000001');
select throws_ok(
  format($$ select public.cancel_appointment(%L, 'declined') $$, (select id from t where name = 's1')),
  '22023', 'invalid_reason', 'pessoa nao usa o motivo do profissional');
select throws_ok(
  format($$ select public.cancel_appointment(%L, 'tive uma crise') $$, (select id from t where name = 's1')),
  '22023', 'invalid_reason', 'texto livre nunca vira motivo');
select lives_ok(format($$ select public.cancel_appointment(%L, 'schedule_change') $$, (select id from t where name = 's1')), 'A cancela');
reset role;
select is(
  (select status || ':' || cancel_reason from public.appointments where id = (select id from t where name = 's1')),
  'cancelled:schedule_change', 'cancelado com quem/quando/motivo fechado, sem apagar');
select is(
  (select count(*)::int from public.notifications where user_id = '29600000-0000-4000-8000-000000000011' and kind = 'appointment_cancelled'),
  1, 'X recebe aviso de cancelamento');

-- Horario liberado volta a ser pedivel.
select pg_temp.as_user('29600000-0000-4000-8000-000000000004');
select isnt(
  public.request_appointment('29600000-0000-4000-8000-0000000000c4', (select ts from t where name = 's1'), 'online', gen_random_uuid()),
  null, 'cancelado nao ocupa agenda: D consegue s1');

-- ---------------------------------------------------------------------------
-- 8. Fim do vinculo cancela o futuro
-- ---------------------------------------------------------------------------

reset role;
update public.professional_connections set status = 'revoked', revoked_at = now()
where id = '29600000-0000-4000-8000-0000000000c4';
select is(
  (select status || ':' || cancel_reason from public.appointments where client_user_id = '29600000-0000-4000-8000-000000000004'),
  'cancelled:relationship_ended', 'vinculo revogado cancela horarios futuros');

-- ---------------------------------------------------------------------------
-- 9. E-mail pelo dispatcher (so com a preferencia ligada)
-- ---------------------------------------------------------------------------

select pg_temp.as_user('29600000-0000-4000-8000-000000000001');
select isnt(
  public.request_appointment('29600000-0000-4000-8000-0000000000c1', (select ts from t where name = 's2'), 'online', gen_random_uuid()),
  null, 'A pede s2');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(
  (select count(*)::int from public.due_notification_emails('America/Sao_Paulo', 500) where user_id = '29600000-0000-4000-8000-000000000011' and kind like 'appointment_%'),
  0, 'e-mail de agenda nasce desligado');
reset role;
update public.notification_preferences set enabled = true
where user_id = '29600000-0000-4000-8000-000000000011' and kind = 'appointment_requested' and channel = 'email';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(
  (select count(*)::int from public.due_notification_emails('America/Sao_Paulo', 500) where user_id = '29600000-0000-4000-8000-000000000011' and kind = 'appointment_requested'),
  1, 'ligado: o dispatcher enxerga o pedido para X');

-- ---------------------------------------------------------------------------
-- 9b. Descoberta: fato de disponibilidade e CTA so com vinculo ativo
-- ---------------------------------------------------------------------------

reset role;
insert into public.professional_public_profiles (user_id, slug, listed, display_name, city, state, modalities, areas, languages)
values ('29600000-0000-4000-8000-000000000011', 'a296000000000011', true, 'Profissional X', 'Recife', 'PE', '{online}', '{ansiedade}', '{pt}');
select pg_temp.as_user('29600000-0000-4000-8000-000000000001');
select ok(public.professional_directory_has_availability('a296000000000011'), 'descoberta: X tem horarios (fato, sem grade)');
select is(public.my_active_connection_for_directory_slug('a296000000000011'),
  '29600000-0000-4000-8000-0000000000c1'::uuid, 'A tem vinculo ativo com X: o CTA leva ao vinculo dele');
select pg_temp.as_user('29600000-0000-4000-8000-000000000002');
select is(public.my_active_connection_for_directory_slug('a296000000000011'), null, 'B sem vinculo com X: sem CTA');
reset role;
set local role anon;
select throws_ok($$ select public.my_active_connection_for_directory_slug('a296000000000011') $$, '42501', null, 'anon nao consulta vinculo por slug');
reset role;
update public.professional_public_profiles set listed = false where user_id = '29600000-0000-4000-8000-000000000011';
select pg_temp.as_user('29600000-0000-4000-8000-000000000001');
select ok(not public.professional_directory_has_availability('a296000000000011'), 'perfil fora da descoberta: nenhum fato de agenda');

-- ---------------------------------------------------------------------------
-- 9c. Lembrete 24 h: deterministico, sem duplicata, so dentro da janela
-- ---------------------------------------------------------------------------

reset role;
insert into public.appointments (id, connection_id, client_user_id, professional_user_id, starts_at, ends_at,
  timezone, modality, status, requested_by, idempotency_key, confirmed_at)
values
  ('29600000-0000-4000-8000-0000000000e1', '29600000-0000-4000-8000-0000000000c2',
   '29600000-0000-4000-8000-000000000002', '29600000-0000-4000-8000-000000000012',
   date_trunc('minute', now()) + interval '20 hours', date_trunc('minute', now()) + interval '21 hours',
   'America/Sao_Paulo', 'online', 'confirmed', '29600000-0000-4000-8000-000000000002', gen_random_uuid(), now()),
  ('29600000-0000-4000-8000-0000000000e2', '29600000-0000-4000-8000-0000000000c2',
   '29600000-0000-4000-8000-000000000002', '29600000-0000-4000-8000-000000000012',
   date_trunc('minute', now()) + interval '30 hours', date_trunc('minute', now()) + interval '31 hours',
   'America/Sao_Paulo', 'online', 'confirmed', '29600000-0000-4000-8000-000000000002', gen_random_uuid(), now());

select pg_temp.as_user('29600000-0000-4000-8000-000000000002');
select lives_ok($$ select public.materialize_in_app_notifications() $$, 'B materializa avisos');
select lives_ok($$ select public.materialize_in_app_notifications() $$, 'B materializa de novo');
reset role;
select is(
  (select count(*)::int from public.notifications
   where user_id = '29600000-0000-4000-8000-000000000002'
     and event_key = 'appointment_reminder:29600000-0000-4000-8000-0000000000e1'),
  1, 'lembrete do horario em 20 h: exatamente um, mesmo lendo duas vezes');
select is(
  (select count(*)::int from public.notifications
   where user_id = '29600000-0000-4000-8000-000000000002'
     and event_key = 'appointment_reminder:29600000-0000-4000-8000-0000000000e2'),
  0, 'horario em 30 h ainda nao gera lembrete');
select pg_temp.as_user('29600000-0000-4000-8000-000000000012');
select lives_ok($$ select public.materialize_in_app_notifications() $$, 'Y materializa avisos');
reset role;
select is(
  (select count(*)::int from public.notifications
   where user_id = '29600000-0000-4000-8000-000000000012'
     and event_key = 'appointment_reminder:29600000-0000-4000-8000-0000000000e1'),
  1, 'o profissional tambem recebe o lembrete');
update public.notification_preferences set enabled = true
where user_id = '29600000-0000-4000-8000-000000000002' and kind = 'appointment_reminder' and channel = 'email';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(
  (select count(*)::int from public.due_notification_emails('America/Sao_Paulo', 500)
   where user_id = '29600000-0000-4000-8000-000000000002'
     and event_key = 'appointment_reminder:29600000-0000-4000-8000-0000000000e1'),
  1, 'e-mail de lembrete ligado: o dispatcher enxerga o lembrete de B');
reset role;

-- ---------------------------------------------------------------------------
-- 10. Horario de verao (America/New_York, domingo 01:00-04:00)
-- ---------------------------------------------------------------------------

reset role;
delete from public.professional_availability_rules where professional_user_id = '29600000-0000-4000-8000-000000000012';
delete from public.professional_availability_exceptions where professional_user_id = '29600000-0000-4000-8000-000000000012';
insert into public.professional_availability_exceptions (professional_user_id,kind,starts_on,ends_on,start_minute,end_minute,slot_minutes,timezone,modality)
values ('29600000-0000-4000-8000-000000000012','open','2026-03-08','2026-03-08',60,240,60,'America/New_York','in_person'),
 ('29600000-0000-4000-8000-000000000012','open','2026-11-01','2026-11-01',60,240,60,'America/New_York','in_person');
select is((select count(*)::int from public.professional_slot_offer('29600000-0000-4000-8000-000000000012', '2026-03-08 07:00+00', 'in_person')),
  1, 'DST (primavera): 03:00 EDT existe e esta na grade');
select is((select count(*)::int from public.professional_slot_offer('29600000-0000-4000-8000-000000000012', '2026-11-01 05:00+00', 'in_person'))
        + (select count(*)::int from public.professional_slot_offer('29600000-0000-4000-8000-000000000012', '2026-11-01 06:00+00', 'in_person')),
  1, 'DST (outono): uma oferta canonica por horario civil, sem duplicacao');

select * from finish();
rollback;
