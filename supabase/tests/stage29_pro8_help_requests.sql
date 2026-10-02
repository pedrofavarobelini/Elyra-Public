-- Stage 29 / PRO-8 — Pedidos de ajuda.
--
-- Prova: so a pessoa envia, so em vinculo ativo com profissional verificado;
-- terceiro nao le; profissional perde a leitura ao revogar/suspender; limites
-- e idempotencia no banco; transicoes fechadas (sem "assumido"); aviso sem
-- conteudo; e-mail so com opt-in; retencao apaga so o texto.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(60);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('29900000-0000-4000-8000-000000000001', 'hr-a@elyra.invalid', now(), '{"display_name":"Pessoa A"}'),
  ('29900000-0000-4000-8000-000000000002', 'hr-b@elyra.invalid', now(), '{"display_name":"Pessoa B"}'),
  ('29900000-0000-4000-8000-000000000003', 'hr-c@elyra.invalid', now(), '{"display_name":"Pessoa C"}'),
  ('29900000-0000-4000-8000-000000000011', 'hr-x@elyra.invalid', now(), '{"display_name":"Conta X"}'),
  ('29900000-0000-4000-8000-000000000012', 'hr-y@elyra.invalid', now(), '{"display_name":"Conta Y"}'),
  ('29900000-0000-4000-8000-000000000013', 'hr-z@elyra.invalid', now(), '{"display_name":"Conta Z"}');

insert into public.professional_profiles (user_id, council_region, registration_number, specialty,
  verification_status, verification_reviewed_at, verification_review_due_at)
values
  ('29900000-0000-4000-8000-000000000011', '06', 'HR-X', 'Psicologia', 'verified', now() - interval '1 day', now() + interval '300 days'),
  ('29900000-0000-4000-8000-000000000012', '06', 'HR-Y', 'Psicologia', 'verified', now() - interval '1 day', now() + interval '300 days'),
  ('29900000-0000-4000-8000-000000000013', '06', 'HR-Z', 'Psicologia', 'pending', null, null);

insert into public.professional_public_profiles (user_id, slug, listed, display_name, city, state, modalities, areas, languages) values
  ('29900000-0000-4000-8000-000000000011', 'c299000000000011', true, 'Profissional X', 'Recife', 'PE', '{online}', '{ansiedade}', '{pt}');

-- A-X ativo, B-X ativo, A-Y ativo, A-Z ativo (Z nao verificado), C-X pausado.
insert into public.professional_connections (
  id, client_user_id, professional_user_id, invited_by_user_id, status, accepted_at, paused_at
) values
  ('29900000-0000-4000-8000-0000000000a1', '29900000-0000-4000-8000-000000000001',
   '29900000-0000-4000-8000-000000000011', '29900000-0000-4000-8000-000000000011', 'active', now(), null),
  ('29900000-0000-4000-8000-0000000000b1', '29900000-0000-4000-8000-000000000002',
   '29900000-0000-4000-8000-000000000011', '29900000-0000-4000-8000-000000000011', 'active', now(), null),
  ('29900000-0000-4000-8000-0000000000a2', '29900000-0000-4000-8000-000000000001',
   '29900000-0000-4000-8000-000000000012', '29900000-0000-4000-8000-000000000012', 'active', now(), null),
  ('29900000-0000-4000-8000-0000000000a3', '29900000-0000-4000-8000-000000000001',
   '29900000-0000-4000-8000-000000000013', '29900000-0000-4000-8000-000000000013', 'active', now(), null),
  ('29900000-0000-4000-8000-0000000000c1', '29900000-0000-4000-8000-000000000003',
   '29900000-0000-4000-8000-000000000011', '29900000-0000-4000-8000-000000000011', 'paused', now(), now());

create or replace function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end;
$$;

-- 1. Superficie --------------------------------------------------------------------

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.help_requests'::regclass),
  'RLS ligada e forcada');
select is((select count(*)::int from pg_policies where tablename = 'help_requests' and cmd <> 'SELECT'), 0,
  'nenhuma policy de escrita: tudo por RPC');
select ok(not has_table_privilege('authenticated', 'public.help_requests', 'INSERT')
  and not has_table_privilege('authenticated', 'public.help_requests', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.help_requests', 'DELETE'),
  'authenticated nao escreve direto');
select ok(not has_table_privilege('anon', 'public.help_requests', 'SELECT'), 'anon nao le');
select ok(not has_function_privilege('authenticated', 'public.purge_help_request_content(integer)', 'EXECUTE'),
  'retencao e so do job (service_role)');
select ok(not has_function_privilege('authenticated', 'public.help_request_notify(uuid, text, uuid)', 'EXECUTE'),
  'aviso nao e chamavel por usuario');
select is((select count(*)::int from public.notification_preferences where user_id = '29900000-0000-4000-8000-000000000001'),
  45, 'a matriz nasce inteira: quinze tipos por tres canais');
select is((select count(*)::int from public.notification_preferences where user_id = '29900000-0000-4000-8000-000000000001'
  and kind like 'help_request_%' and channel <> 'in_app' and enabled), 0,
  'push e e-mail dos pedidos nascem desligados');

set local role anon;
select throws_ok($$ select public.create_help_request('29900000-0000-4000-8000-0000000000a1', 'oi', gen_random_uuid()) $$,
  '42501', null, 'anon nao envia');
reset role;

-- 2. Envio -------------------------------------------------------------------------

select pg_temp.as_user('29900000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.list_my_help_request_targets()), 2,
  'A pode escrever para X e Y; Z (nao verificado) fica de fora');
select is((select professional_name from public.list_my_help_request_targets() where connection_id = '29900000-0000-4000-8000-0000000000a1'),
  'Profissional X', 'destino mostra o nome publico');

create temp table ids (label text primary key, id uuid);
grant all on ids to authenticated, service_role;
insert into ids values ('k1', gen_random_uuid());

select lives_ok($$ insert into ids select 'r1', public.create_help_request(
  '29900000-0000-4000-8000-0000000000a1', '  Queria conversar sobre a semana.  ', (select id from ids where label = 'k1')) $$,
  'A envia a X');
select is((select public.create_help_request('29900000-0000-4000-8000-0000000000a1', 'outro texto', (select id from ids where label = 'k1'))),
  (select id from ids where label = 'r1'), 'mesma chave: devolve o mesmo pedido (idempotente)');
select throws_ok($$ select public.create_help_request('29900000-0000-4000-8000-0000000000a2', 'x', (select id from ids where label = 'k1')) $$,
  '22023', 'idempotency_mismatch', 'mesma chave para outro vinculo: recusa');
select throws_ok($$ select public.create_help_request('29900000-0000-4000-8000-0000000000a1', 'de novo', gen_random_uuid()) $$,
  '23505', 'help_request_waiting', 'um pedido em espera por vinculo');
select throws_ok($$ select public.create_help_request('29900000-0000-4000-8000-0000000000a2', '   ', gen_random_uuid()) $$,
  '22023', 'invalid_body', 'texto vazio: recusa');
select throws_ok($$ select public.create_help_request('29900000-0000-4000-8000-0000000000a2', repeat('a', 1001), gen_random_uuid()) $$,
  '22023', 'invalid_body', 'mais de 1000 caracteres: recusa');
select throws_ok($$ select public.create_help_request('29900000-0000-4000-8000-0000000000a3', 'oi', gen_random_uuid()) $$,
  '42501', 'professional_unavailable', 'profissional sem verificacao vigente: recusa');
select throws_ok($$ select public.create_help_request('29900000-0000-4000-8000-0000000000b1', 'oi', gen_random_uuid()) $$,
  'P0002', 'relationship_not_found', 'vinculo de outra pessoa: nao existe');
select is((select body from public.list_my_help_requests() where id = (select id from ids where label = 'r1')),
  'Queria conversar sobre a semana.', 'texto guardado sem espacos das pontas');
select is((select status from public.list_my_help_requests() where id = (select id from ids where label = 'r1')),
  'open', 'estado inicial: enviado');
select ok((select waiting from public.list_my_help_request_targets() where connection_id = '29900000-0000-4000-8000-0000000000a1'),
  'destino mostra que ja ha pedido em espera');
reset role;

select pg_temp.as_user('29900000-0000-4000-8000-000000000003');
select throws_ok($$ select public.create_help_request('29900000-0000-4000-8000-0000000000c1', 'oi', gen_random_uuid()) $$,
  '42501', 'relationship_inactive', 'vinculo pausado: recusa');
reset role;

select pg_temp.as_user('29900000-0000-4000-8000-000000000011');
select throws_ok($$ select public.create_help_request('29900000-0000-4000-8000-0000000000a1', 'oi', gen_random_uuid()) $$,
  'P0002', 'relationship_not_found', 'profissional nao abre pedido (so a pessoa)');
reset role;

-- 3. Aviso sem conteudo ------------------------------------------------------------

select is((select count(*)::int from public.notifications where user_id = '29900000-0000-4000-8000-000000000011'
  and kind = 'help_request_received'), 1, 'X recebe um aviso (replay nao duplica)');
select is((select count(*)::int from public.notifications where kind like 'help_request_%'
  and event_key !~ '^help_request_(received|updated):[0-9a-f-]{36}$'), 0, 'chave do aviso so tem o id');
select is((select count(*)::int from public.audit_logs where entity_type = 'help_request'
  and action = 'help_request.created'), 1, 'trilha registra o envio');
select is((select count(*)::int from information_schema.columns where table_schema = 'public'
  and table_name in ('notifications', 'audit_logs') and column_name in ('body', 'message', 'content')), 0,
  'aviso e trilha nao tem coluna de texto livre');

-- 4. Leitura -----------------------------------------------------------------------

select pg_temp.as_user('29900000-0000-4000-8000-000000000011');
select is((select count(*)::int from public.help_requests), 1, 'X le o pedido de A (vinculo ativo)');
select is((select counterpart_name from public.list_my_help_requests()), 'Pessoa A', 'X ve o nome da pessoa');
select is((select role from public.list_my_help_requests()), 'professional', 'papel correto');
reset role;
select pg_temp.as_user('29900000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.help_requests), 0, 'B (mesmo profissional) nao le o pedido de A');
select is((select count(*)::int from public.list_my_help_requests()), 0, 'nem pela funcao');
select throws_ok($$ select public.transition_help_request((select id from ids where label = 'r1'), 'cancel') $$,
  'P0002', 'help_request_not_found', 'B nao age no pedido de A');
reset role;
select pg_temp.as_user('29900000-0000-4000-8000-000000000012');
select is((select count(*)::int from public.help_requests), 0, 'Y nao le pedido enderecado a X');
reset role;

-- 5. Transicoes --------------------------------------------------------------------

select pg_temp.as_user('29900000-0000-4000-8000-000000000001');
select throws_ok($$ select public.transition_help_request((select id from ids where label = 'r1'), 'seen') $$,
  '22023', 'invalid_transition', 'a pessoa nao marca como lido');
select throws_ok($$ select public.transition_help_request((select id from ids where label = 'r1'), 'close') $$,
  '22023', 'invalid_transition', 'antes de lido, a pessoa cancela (nao encerra)');
reset role;

select pg_temp.as_user('29900000-0000-4000-8000-000000000011');
select is(public.transition_help_request((select id from ids where label = 'r1'), 'seen'), 'seen', 'X marca como lido');
select is(public.transition_help_request((select id from ids where label = 'r1'), 'seen'), 'seen', 'lido de novo: no-op');
select throws_ok($$ select public.transition_help_request((select id from ids where label = 'r1'), 'cancel') $$,
  '22023', 'invalid_transition', 'profissional nao cancela pela pessoa');
select throws_ok($$ select public.transition_help_request((select id from ids where label = 'r1'), 'claim') $$,
  '22023', 'invalid_request', 'nao existe "assumir"');
select is(public.transition_help_request((select id from ids where label = 'r1'), 'responded'), 'responded',
  'X marca que respondeu');
reset role;

select is((select count(*)::int from public.notifications where user_id = '29900000-0000-4000-8000-000000000001'
  and kind = 'help_request_updated'), 1, 'A recebe o aviso de respondido');

select pg_temp.as_user('29900000-0000-4000-8000-000000000001');
select throws_ok($$ select public.transition_help_request((select id from ids where label = 'r1'), 'cancel') $$,
  '22023', 'invalid_transition', 'depois de lido nao cancela');
select is(public.transition_help_request((select id from ids where label = 'r1'), 'close'), 'closed', 'A encerra');
select throws_ok($$ select public.transition_help_request((select id from ids where label = 'r1'), 'close') $$,
  '22023', 'invalid_transition', 'encerrado e final');

-- Cancelar enquanto enviado, e a vaga do vinculo volta.
insert into ids select 'r2', public.create_help_request('29900000-0000-4000-8000-0000000000a2', 'Para Y', gen_random_uuid());
select is(public.transition_help_request((select id from ids where label = 'r2'), 'cancel'), 'cancelled',
  'A cancela enquanto ainda nao foi lido');
select lives_ok($$ select public.create_help_request('29900000-0000-4000-8000-0000000000a2', 'Para Y de novo', gen_random_uuid()) $$,
  'vaga liberada apos cancelar');
select throws_ok($$ select public.create_help_request('29900000-0000-4000-8000-0000000000a1', 'quarto', gen_random_uuid()) $$,
  '54000', 'help_request_limit', 'quarto pedido em 24 h: limite');
reset role;

-- 6. Revogar vinculo e suspender verificacao cortam a leitura na hora ----------------

update public.professional_connections set status = 'ended', ended_at = now(),
  ended_by_user_id = '29900000-0000-4000-8000-000000000001'
where id = '29900000-0000-4000-8000-0000000000a1';
select pg_temp.as_user('29900000-0000-4000-8000-000000000011');
select is((select count(*)::int from public.help_requests), 0, 'vinculo encerrado: X nao le mais');
reset role;
select pg_temp.as_user('29900000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.list_my_help_requests()
  where connection_id = '29900000-0000-4000-8000-0000000000a1'), 1, 'a pessoa continua vendo o proprio historico');
reset role;

update public.professional_profiles set verification_status = 'suspended'
where user_id = '29900000-0000-4000-8000-000000000012';
select pg_temp.as_user('29900000-0000-4000-8000-000000000012');
select is((select count(*)::int from public.help_requests), 0, 'profissional suspenso nao le');
select throws_ok($$ select public.transition_help_request(
  (select id from public.help_requests where status = 'open' limit 1), 'seen') $$,
  'P0002', null, 'profissional suspenso nao age');
reset role;

-- 7. Expiracao e retencao ------------------------------------------------------------

update public.help_requests set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
where connection_id = '29900000-0000-4000-8000-0000000000a2' and status = 'open';
select pg_temp.as_user('29900000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.list_my_help_requests() where status = 'expired'), 1,
  'espera vencida aparece como expirada antes do job');
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((select expired from public.purge_help_request_content(100)), 1, 'job materializa a expiracao');
reset role;
update public.help_requests set ended_at = now() - interval '31 days' where status in ('closed', 'expired');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((select purged from public.purge_help_request_content(100)), 2, 'job apaga o texto de fim ha mais de 30 dias');
reset role;
select is((select count(*)::int from public.help_requests where body is not null and status = 'cancelled'), 1,
  'cancelado recente mantem o texto');
select is((select count(*)::int from public.help_requests where body is null and body_purged_at is not null), 2,
  'a linha fica, sem conteudo');
select throws_ok($$ update public.help_requests set body = null where status = 'cancelled' and body_purged_at is null $$,
  '23514', null, 'texto so some junto com o carimbo de retencao');

-- 8. E-mail so com opt-in (sem conteudo) ---------------------------------------------

select pg_temp.as_user('29900000-0000-4000-8000-000000000002');
insert into ids select 'r3', public.create_help_request('29900000-0000-4000-8000-0000000000b1', 'Texto que nao sai', gen_random_uuid());
reset role;
update public.notification_preferences set enabled = true
where user_id = '29900000-0000-4000-8000-000000000011' and kind = 'help_request_received' and channel = 'email';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((select event_key from public.due_notification_emails('America/Sao_Paulo', 500)
  where user_id = '29900000-0000-4000-8000-000000000011' and kind = 'help_request_received'),
  'help_request_received:' || (select id from ids where label = 'r3')::text,
  'com e-mail ligado, o dispatcher enxerga o pedido so pelo id');
reset role;

select * from finish();
rollback;
