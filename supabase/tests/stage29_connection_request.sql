-- Stage 29 — Fluxo B: a pessoa solicita acompanhamento pela descoberta.
--
-- Prova: mesma relationship do fluxo A (professional_connections pending),
-- elegibilidade da descoberta (opt-in + verificacao vigente), idempotencia,
-- anti-abuso no banco, aceite pelo mesmo RPC, nenhum grant implicito,
-- notificacao in-app para os dois lados e e-mail so com opt-in.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(29);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('29800000-0000-4000-8000-000000000001', 'flowb-a@elyra.invalid', now(), '{"display_name":"Pessoa A"}'),
  ('29800000-0000-4000-8000-000000000002', 'flowb-b@elyra.invalid', now(), '{"display_name":"Pessoa B"}'),
  ('29800000-0000-4000-8000-000000000011', 'flowb-x@elyra.invalid', now(), '{"display_name":"Conta X"}'),
  ('29800000-0000-4000-8000-000000000012', 'flowb-y@elyra.invalid', now(), '{"display_name":"Conta Y"}'),
  ('29800000-0000-4000-8000-000000000013', 'flowb-z@elyra.invalid', now(), '{"display_name":"Conta Z"}');

insert into public.professional_profiles (user_id, council_region, registration_number, specialty,
  verification_status, verification_reviewed_at, verification_review_due_at)
values
  ('29800000-0000-4000-8000-000000000011', '06', 'FB-X', 'Psicologia', 'verified', now() - interval '1 day', now() + interval '300 days'),
  ('29800000-0000-4000-8000-000000000012', '06', 'FB-Y', 'Psicologia', 'pending', null, null),
  ('29800000-0000-4000-8000-000000000013', '06', 'FB-Z', 'Psicologia', 'verified', now() - interval '1 day', now() + interval '300 days');

insert into public.professional_public_profiles (user_id, slug, listed, display_name, city, state, modalities, areas, languages) values
  ('29800000-0000-4000-8000-000000000011', 'b298000000000011', true, 'Profissional X', 'Recife', 'PE', '{online}', '{ansiedade}', '{pt}'),
  ('29800000-0000-4000-8000-000000000012', 'b298000000000012', true, 'Profissional Y', 'Recife', 'PE', '{online}', '{ansiedade}', '{pt}'),
  ('29800000-0000-4000-8000-000000000013', 'b298000000000013', false, 'Profissional Z', 'Recife', 'PE', '{online}', '{ansiedade}', '{pt}');

create or replace function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end;
$$;

-- 1. Superficie ------------------------------------------------------------------

set local role anon;
select throws_ok($$ select * from public.request_professional_connection('b298000000000011') $$, '42501', null,
  'anon nao pede acompanhamento');
reset role;
select is((select count(*)::int from public.notification_preferences where user_id = '29800000-0000-4000-8000-000000000001'),
  45, 'a matriz nasce inteira: quinze tipos por tres canais (L-433: convite aceito)');
select is((select count(*)::int from public.notification_preferences where user_id = '29800000-0000-4000-8000-000000000001'
  and kind in ('connection_requested', 'relationship_created') and channel = 'email' and enabled), 0,
  'e-mail dos tipos novos nasce desligado');

-- 2. Pedido ------------------------------------------------------------------------

select pg_temp.as_user('29800000-0000-4000-8000-000000000001');
select is((select status from public.request_professional_connection('b298000000000011')), 'pending',
  'A pede acompanhamento a X pela descoberta: pending');
select is((select status from public.request_professional_connection('b298000000000011')), 'pending',
  'repetir o pedido e idempotente');
select throws_ok($$ select * from public.request_professional_connection('b298000000000012') $$, 'P0002', 'professional_unavailable',
  'profissional sem verificacao vigente: indisponivel');
select throws_ok($$ select * from public.request_professional_connection('b298000000000013') $$, 'P0002', 'professional_unavailable',
  'perfil fora da descoberta: indisponivel');
select throws_ok($$ select * from public.request_professional_connection('nao-e-slug') $$, 'P0002', 'professional_unavailable',
  'slug invalido: mesma resposta');
select is((select status from public.my_connection_for_directory_slug('b298000000000011')), 'pending', 'A ve o proprio pedido');
select is((select professional_name from public.list_my_connection_professional_names()), 'Profissional X',
  'A ve o nome publico do profissional, nao o UUID');
reset role;
select is((select count(*)::int from public.professional_connections
  where client_user_id = '29800000-0000-4000-8000-000000000001'), 1, 'uma linha so (mesma relationship do fluxo A)');
select is((select invited_by_user_id from public.professional_connections
  where client_user_id = '29800000-0000-4000-8000-000000000001'), '29800000-0000-4000-8000-000000000001'::uuid,
  'origem registrada: a pessoa');
select is((select count(*)::int from public.notifications where user_id = '29800000-0000-4000-8000-000000000011'
  and kind = 'connection_requested'), 1, 'X recebe um aviso in-app (repetir nao duplica)');

select pg_temp.as_user('29800000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.my_connection_for_directory_slug('b298000000000011')), 0,
  'B nao ve o pedido de A');
select pg_temp.as_user('29800000-0000-4000-8000-000000000011');
select throws_ok($$ select * from public.request_professional_connection('b298000000000011') $$, 'P0002', 'professional_unavailable',
  'profissional nao pede acompanhamento a si mesmo');
reset role;

-- 3. E-mail so com opt-in ---------------------------------------------------------

update public.notification_preferences set enabled = true
where user_id = '29800000-0000-4000-8000-000000000011' and kind = 'connection_requested' and channel = 'email';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((select count(*)::int from public.due_notification_emails('America/Sao_Paulo', 500)
  where user_id = '29800000-0000-4000-8000-000000000011' and kind = 'connection_requested'), 1,
  'com e-mail ligado, o dispatcher enxerga o pedido para X');
reset role;

-- 4. Aceite pelo mesmo RPC do fluxo A --------------------------------------------

select pg_temp.as_user('29800000-0000-4000-8000-000000000011');
select lives_ok($$ select public.respond_professional_invitation(
  (select id from public.professional_connections where client_user_id = '29800000-0000-4000-8000-000000000001'), true) $$,
  'X aceita pela Central de solicitacoes');
reset role;
select is((select status from public.professional_connections where client_user_id = '29800000-0000-4000-8000-000000000001'),
  'active', 'vinculo ativo');
select is((select count(*)::int from public.sharing_permissions where connection_id =
  (select id from public.professional_connections where client_user_id = '29800000-0000-4000-8000-000000000001')), 0,
  'aceitar nao cria grant nenhum');
select is((select count(*)::int from public.notifications where user_id = '29800000-0000-4000-8000-000000000001'
  and kind = 'relationship_created'), 1, 'A recebe o aviso de aceite');
select pg_temp.as_user('29800000-0000-4000-8000-000000000001');
select is((select status from public.request_professional_connection('b298000000000011')), 'active',
  'pedir de novo com vinculo ativo nao muda nada');

-- 5. Anti-abuso ---------------------------------------------------------------------

select lives_ok($$ select public.revoke_professional_connection(
  (select id from public.professional_connections where client_user_id = '29800000-0000-4000-8000-000000000001')) $$,
  'A encerra o vinculo');
select is((select status from public.request_professional_connection('b298000000000011')), 'pending', 'segundo pedido em 30 dias');
select lives_ok($$ select public.revoke_professional_connection(
  (select id from public.professional_connections where client_user_id = '29800000-0000-4000-8000-000000000001')) $$,
  'A cancela o pedido');
select lives_ok($$ select * from public.request_professional_connection('b298000000000011') $$, 'terceiro pedido em 30 dias');
select lives_ok($$ select public.revoke_professional_connection(
  (select id from public.professional_connections where client_user_id = '29800000-0000-4000-8000-000000000001')) $$,
  'A cancela de novo');
select throws_ok($$ select * from public.request_professional_connection('b298000000000011') $$, '54000', 'request_limit',
  'quarto pedido ao mesmo profissional em 30 dias: limite');
reset role;
select pg_temp.as_user('29800000-0000-4000-8000-000000000002');
select lives_ok($$ select * from public.request_professional_connection('b298000000000011') $$, 'B pede');
reset role;
select pg_temp.as_user('29800000-0000-4000-8000-000000000011');
select public.respond_professional_invitation(
  (select id from public.professional_connections where client_user_id = '29800000-0000-4000-8000-000000000002'), false);
reset role;
select pg_temp.as_user('29800000-0000-4000-8000-000000000002');
select throws_ok($$ select * from public.request_professional_connection('b298000000000011') $$, '54000', 'request_limit',
  'recusado pelo profissional: 7 dias antes de pedir de novo');

select * from finish();
rollback;
