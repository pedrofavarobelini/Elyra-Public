-- SUP-1 - Rede de Apoio: snapshot oficial, projecao, RLS e guardas.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(52);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', '5a910000-0000-4000-8000-000000000001', 'authenticated',
  'authenticated', 'sup1-a@elyra.invalid', null, timezone('utc', now()), '', '', '', '', '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Pessoa SUP1"}'::jsonb,
  timezone('utc', now()), timezone('utc', now())
);

create function pg_temp.as_user() returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', '5a910000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
end;
$$;

create temporary table s (label text primary key, id uuid) on commit drop;
grant all on s to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Estrutura, RLS e privilegios
-- ---------------------------------------------------------------------------

select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
  where oid in ('public.support_network_settings'::regclass, 'public.support_network_snapshots'::regclass,
                'public.support_facility_types'::regclass, 'public.support_facility_categories'::regclass,
                'public.support_facilities'::regclass)), 'RLS forcada nas cinco tabelas');
select ok(not has_table_privilege('authenticated', 'public.support_facilities', 'SELECT')
  and not has_table_privilege('authenticated', 'public.support_facilities', 'INSERT')
  and not has_table_privilege('authenticated', 'public.support_network_snapshots', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.support_network_settings', 'UPDATE'),
  'usuario nao le nem escreve tabela: so projecao por RPC');
select ok(not has_table_privilege('anon', 'public.support_facilities', 'SELECT'), 'anon nao le tabela');
select ok(not has_function_privilege('anon', 'public.search_support_facilities(text, text[], text, integer, integer)', 'EXECUTE'),
  'anon nao busca (D-SUP-9: leitura autenticada)');
select ok(has_function_privilege('authenticated', 'public.search_support_facilities(text, text[], text, integer, integer)', 'EXECUTE'),
  'autenticado busca pela projecao');
select ok(not has_function_privilege('authenticated', 'public.support_network_activate_snapshot(uuid, numeric)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.support_network_seal_snapshot(uuid, integer, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.support_network_rollback_snapshot(uuid)', 'EXECUTE'),
  'usuario nao sela, ativa nem faz rollback');
select ok(has_function_privilege('service_role', 'public.support_network_activate_snapshot(uuid, numeric)', 'EXECUTE'),
  'importador (service_role) ativa');

-- ---------------------------------------------------------------------------
-- 2. Interruptores: licenca nao resolvida, dado real bloqueado, fixture oculta
-- ---------------------------------------------------------------------------

select is((select license_status || '/' || real_import_enabled || '/' || fixtures_visible
  from public.support_network_settings), 'UNRESOLVED/false/false', 'padroes fail-closed');
select throws_ok($$ update public.support_network_settings set real_import_enabled = true $$,
  '23514', null, 'dado real nao liga sem licenca VERIFIED');
select throws_ok(
  $$ insert into public.support_network_snapshots (source, source_reference_date, source_identifier, source_sha256, schema_version)
     values ('cnes_download', '2026-08-01', 'BASE_DE_DADOS_CNES_202608.ZIP', repeat('a', 64), 'cnes-mapped-1') $$,
  '42501', 'real_import_disabled', 'snapshot de fonte real e recusado com importacao real desligada');
select throws_ok(
  $$ insert into public.support_network_snapshots (source, source_reference_date, source_identifier, source_sha256, schema_version, status)
     values ('qa_fixture', '2026-01-01', 'qa-fixture-x.csv', repeat('c', 64), 'qa-fixture-1', 'active') $$,
  '22023', 'snapshot_must_start_staging', 'snapshot nasce em montagem');

-- ---------------------------------------------------------------------------
-- 3. Snapshot de fixture: montagem, validacao, selo, ativacao
-- ---------------------------------------------------------------------------

with created as (
  insert into public.support_network_snapshots (source, source_reference_date, source_identifier, source_sha256, schema_version)
  values ('qa_fixture', '2026-01-01', 'qa-fixture-support-network.csv', repeat('b', 64), 'qa-fixture-1')
  returning id)
insert into s (label, id) select 's1', id from created;

insert into public.support_facility_types (snapshot_id, official_type_code, official_type_name)
select id, code, name from s, (values ('02', 'CENTRO DE SAUDE/UNIDADE BASICA'), ('70', 'CENTRO DE ATENCAO PSICOSSOCIAL'),
  ('99', 'TIPO QA SEM MAPEAMENTO')) as t(code, name) where s.label = 's1';

insert into public.support_facilities (snapshot_id, cnes_code, official_name, official_type_code, municipality_code,
  state_code, phone_display, phone_digits, latitude, longitude, coordinate_status, source_active)
select id, code, name, type, '355030', 'SP', phone, digits, lat, lng, status, active
from s, (values
  ('9900001', '[DEMO] UBS Ficticia Alfa', '02', '(11) 0000-0001', '1100000001', -23.550000, -46.630000, 'valid', true),
  ('9900002', '[DEMO] CAPS Ficticio Beta', '70', null, null, null::numeric, null::numeric, 'missing', null),
  ('9900003', '[DEMO] Tipo sem mapeamento', '99', null, null, null, null, 'invalid', true),
  ('9900004', '[DEMO] UBS Ficticia Gama', '02', null, null, -23.560000, -46.640000, 'valid', null),
  ('9900005', '[DEMO] Unidade desativada', '02', null, null, null, null, 'missing', false)
) as rows(code, name, type, phone, digits, lat, lng, status, active)
where s.label = 's1';

select throws_ok(
  $$ insert into public.support_facilities (snapshot_id, cnes_code, official_name, official_type_code, municipality_code, state_code, coordinate_status)
     select id, '9900001', 'Duplicada', '02', '355030', 'SP', 'missing' from s where label = 's1' $$,
  '23505', null, 'CNES duplicado no mesmo snapshot e recusado');
select throws_ok(
  $$ insert into public.support_facilities (snapshot_id, cnes_code, official_name, official_type_code, municipality_code, state_code, coordinate_status)
     select id, '9900009', 'Coordenada fingida', '02', '355030', 'SP', 'valid' from s where label = 's1' $$,
  '23514', null, 'status valid sem coordenada e recusado');
select throws_ok(
  $$ insert into public.support_facilities (snapshot_id, cnes_code, official_name, official_type_code, municipality_code, state_code, coordinate_status, latitude, longitude)
     select id, '9900010', 'Latitude impossivel', '02', '355030', 'SP', 'valid', 95, 10 from s where label = 's1' $$,
  '23514', null, 'latitude fora de [-90, 90] e recusada');
select throws_ok(
  $$ insert into public.support_facilities (snapshot_id, cnes_code, official_name, official_type_code, municipality_code, state_code, coordinate_status)
     select id, '9900011', 'Tipo inexistente', '55', '355030', 'SP', 'missing' from s where label = 's1' $$,
  '23503', null, 'tipo sem registro no snapshot e recusado');
select throws_ok(
  $$ insert into public.support_facilities (snapshot_id, cnes_code, official_name, official_type_code, municipality_code, state_code, coordinate_status)
     select id, '9900012', 'UF invalida', '02', '355030', 'XX', 'missing' from s where label = 's1' $$,
  '23514', null, 'UF fora da lista e recusada');

select throws_ok($$ select public.support_network_seal_snapshot((select id from s where label = 's1'), 99, 0) $$,
  '22023', 'snapshot_count_mismatch', 'selo recusa contagem que nao bate');
select lives_ok($$ select public.support_network_seal_snapshot((select id from s where label = 's1'), 7, 2) $$,
  'selo com lidas = aceitas + rejeitadas');
select is((select status || ':' || accepted_count || ':' || rejected_count from public.support_network_snapshots
  where id = (select id from s where label = 's1')), 'inactive:5:2', 'snapshot selado e inativo com contagens');
select throws_ok(
  $$ insert into public.support_facilities (snapshot_id, cnes_code, official_name, official_type_code, municipality_code, state_code, coordinate_status)
     select id, '9900020', 'Depois do selo', '02', '355030', 'SP', 'missing' from s where label = 's1' $$,
  '42501', 'snapshot_not_staging', 'depois do selo nenhuma linha entra');
select throws_ok(
  $$ delete from public.support_facilities where snapshot_id = (select id from s where label = 's1') $$,
  '42501', 'snapshot_not_staging', 'nem sai');
select throws_ok(
  $$ update public.support_network_snapshots set source_sha256 = repeat('f', 64) where id = (select id from s where label = 's1') $$,
  '22023', 'snapshot_provenance_immutable', 'procedencia e imutavel');
select throws_ok(
  $$ insert into public.support_network_snapshots (source, source_reference_date, source_identifier, source_sha256, schema_version)
     values ('qa_fixture', '2026-01-01', 'qa-fixture-support-network.csv', repeat('b', 64), 'qa-fixture-1') $$,
  '23505', null, 'mesma fonte + competencia + sha256 nao duplica (idempotencia)');
select lives_ok($$ select public.support_network_activate_snapshot((select id from s where label = 's1')) $$,
  'fixture ativa');

-- ---------------------------------------------------------------------------
-- 4. Projecao: fixture invisivel por padrao
-- ---------------------------------------------------------------------------

select pg_temp.as_user();
select is((select count(*)::int from public.search_support_facilities('355030')), 0,
  'fixture ativa mas invisivel: zero linhas (padrao de producao)');
select is((select count(*)::int from public.support_network_provenance()), 0, 'sem procedencia visivel');
select throws_ok($$ select * from public.support_facilities $$, '42501', null, 'tabela nao e legivel pelo usuario');
reset role;

update public.support_network_settings set fixtures_visible = true;

select pg_temp.as_user();
select is((select count(*)::int from public.search_support_facilities('355030')), 4,
  'modo demo: 4 unidades (desativada explicita fica de fora)');
select is((select count(*)::int from public.search_support_facilities('3550308')), 4,
  'codigo IBGE de 7 digitos casa pelo prefixo de 6');
select ok((select bool_and(category is null) from public.search_support_facilities('355030')),
  'nenhuma categoria de UX sem mapeamento confirmado');
select is((select official_type_name from public.search_support_facilities('355030') where cnes_code = '9900002'),
  'CENTRO DE ATENCAO PSICOSSOCIAL', 'tipo oficial literal preservado');
select is((select coordinate_status from public.search_support_facilities('355030') where cnes_code = '9900003'),
  'invalid', 'unidade com coordenada invalida continua na lista, sem coordenada');
select is((select count(*)::int from public.search_support_facilities('355030', array['02'])), 2,
  'filtro por tipo oficial');
select is((select count(*)::int from public.search_support_facilities('355030', null, 'primary_care')), 0,
  'filtro por categoria nao confirmada nao devolve nada');
select is((select count(*)::int from public.get_support_facility('9900001')), 1, 'detalhe pelo CNES');
select throws_ok($$ select * from public.get_support_facility('abc') $$, '22023', 'invalid_cnes', 'CNES invalido recusado');
select throws_ok($$ select * from public.search_support_facilities('35') $$, '22023', 'invalid_municipality', 'municipio invalido recusado');
select throws_ok($$ select * from public.search_support_facilities('355030', null, null, 500) $$, '22023', 'invalid_page', 'pagina acima de 100 recusada');
select ok((select is_fixture and age_days > 90 and facility_count = 5 from public.support_network_provenance()),
  'procedencia: fixture marcada, idade em dias, contagem publicada');
select is((select facility_count from public.list_support_facility_types() where official_type_code = '99'), 1,
  'tipo desconhecido listado pelo codigo oficial, sem categoria');
reset role;

-- ---------------------------------------------------------------------------
-- 5. Segundo snapshot: queda de contagem, troca atomica, sem contaminacao, rollback
-- ---------------------------------------------------------------------------

with created as (
  insert into public.support_network_snapshots (source, source_reference_date, source_identifier, source_sha256, schema_version)
  values ('qa_fixture', '2026-02-01', 'qa-fixture-support-network-2.csv', repeat('d', 64), 'qa-fixture-1')
  returning id)
insert into s (label, id) select 's2', id from created;
insert into public.support_facility_types (snapshot_id, official_type_code, official_type_name)
select id, '02', 'CENTRO DE SAUDE/UNIDADE BASICA' from s where label = 's2';
insert into public.support_facilities (snapshot_id, cnes_code, official_name, official_type_code, municipality_code, state_code, coordinate_status)
select id, '9900031', '[DEMO] Unica do segundo', '02', '355030', 'SP', 'missing' from s where label = 's2';
select public.support_network_seal_snapshot((select id from s where label = 's2'), 1, 0);

select throws_ok($$ select public.support_network_activate_snapshot((select id from s where label = 's2')) $$,
  '22023', 'count_drop_exceeded', 'queda de 5 para 1 bloqueia a troca');
select is((select public.support_network_activate_snapshot((select id from s where label = 's2'), 1)),
  (select id from s where label = 's1'), 'com limite explicito troca e devolve o anterior');
select is((select count(*)::int from public.support_network_snapshots where source = 'qa_fixture' and status = 'active'), 1,
  'um unico ativo por fonte');

select pg_temp.as_user();
select is((select string_agg(cnes_code, ',') from public.search_support_facilities('355030')), '9900031',
  'sem contaminacao: so linhas do snapshot ativo');
reset role;

select is((select public.support_network_rollback_snapshot((select id from s where label = 's1'))),
  (select id from s where label = 's2'), 'rollback reativa o anterior');
select pg_temp.as_user();
select is((select count(*)::int from public.search_support_facilities('355030')), 4, 'dados anteriores de volta');
reset role;
select throws_ok(
  $$ update public.support_network_snapshots set status = 'inactive' where id = (select id from s where label = 's2') $$,
  '22023', 'invalid_snapshot_transition', 'transicao fora do ciclo recusada');
select throws_ok($$ delete from public.support_network_snapshots where id = (select id from s where label = 's1') $$,
  '42501', 'active_snapshot_not_deletable', 'snapshot ativo nao pode ser apagado');
select lives_ok($$ delete from public.support_network_snapshots where id = (select id from s where label = 's2') $$,
  'snapshot superseded pode ser apagado (cascata das linhas permitida)');

-- ---------------------------------------------------------------------------
-- 6. Mapa de categoria: so exposto quando confirmado na fonte oficial
-- ---------------------------------------------------------------------------

select throws_ok($$ update public.support_facility_categories set confirmed = true where official_type_code = '02' $$,
  '23514', null, 'nao confirma com evidencia de busca secundaria');
update public.support_facility_categories
set confirmed = true, evidence = 'official_source_confirmed', reviewed_at = now(), mapping_version = 'sup1-map-2'
where official_type_code = '02';
select pg_temp.as_user();
select is((select count(*)::int from public.search_support_facilities('355030', null, 'primary_care')), 2,
  'categoria confirmada filtra pelos tipos oficiais mapeados');
reset role;

-- ---------------------------------------------------------------------------
-- 7. Licenca verificada libera o caminho real (so entao)
-- ---------------------------------------------------------------------------

update public.support_network_settings set license_status = 'VERIFIED', real_import_enabled = true;
select lives_ok(
  $$ insert into public.support_network_snapshots (source, source_reference_date, source_identifier, source_sha256, schema_version)
     values ('cnes_download', '2026-08-01', 'BASE_DE_DADOS_CNES_202608.ZIP', repeat('e', 64), 'cnes-mapped-1') $$,
  'com licenca VERIFIED e interruptor ligado a fonte real entra (em montagem)');

select * from finish();
rollback;
