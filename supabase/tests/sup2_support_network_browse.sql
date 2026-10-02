-- SUP-2 - Rede de Apoio: catalogo de municipios e tipos por municipio (ADR-0032).

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', '5a920000-0000-4000-8000-000000000001', 'authenticated',
  'authenticated', 'sup2-a@elyra.invalid', null, timezone('utc', now()), '', '', '', '', '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Pessoa SUP2"}'::jsonb,
  timezone('utc', now()), timezone('utc', now())
);

create function pg_temp.as_user() returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', '5a920000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
end;
$$;

create temporary table s (label text primary key, id uuid) on commit drop;
grant all on s to authenticated;

-- Um snapshot de fixture limpo, isolado de qualquer outro ativo.
update public.support_network_snapshots set status = 'superseded' where status = 'active';

with created as (
  insert into public.support_network_snapshots (source, source_reference_date, source_identifier, source_sha256, schema_version)
  values ('qa_fixture', '2026-02-01', 'sup2-fixture.csv', repeat('d', 64), 'qa-fixture-1')
  returning id)
insert into s (label, id) select 'f', id from created;

insert into public.support_facility_types (snapshot_id, official_type_code, official_type_name)
select id, code, name from s, (values ('02', 'CENTRO DE SAUDE/UNIDADE BASICA'), ('70', 'CENTRO DE ATENCAO PSICOSSOCIAL'))
  as t(code, name) where s.label = 'f';

insert into public.support_facilities (snapshot_id, cnes_code, official_name, official_type_code, municipality_code,
  municipality_name, state_code, latitude, longitude, coordinate_status, source_active)
select id, code, name, type, mun, mun_name, uf, lat, lng, status, active
from s, (values
  ('9910001', '[DEMO] A', '02', '355030',  'São Paulo', 'SP', -23.551234, -46.631234, 'valid', true),
  ('9910002', '[DEMO] B', '70', '3550308', 'São Paulo', 'SP', -23.561234, -46.651234, 'valid', null),
  ('9910003', '[DEMO] C', '02', '355030',  'São Paulo', 'SP', null::numeric, null::numeric, 'missing', true),
  ('9910004', '[DEMO] D inativa', '02', '355030', 'São Paulo', 'SP', -10.000000, -40.000000, 'valid', false),
  ('9910005', '[DEMO] E', '02', '330455',  'Rio de Janeiro', 'RJ', -22.906000, -43.172000, 'valid', true)
) as rows(code, name, type, mun, mun_name, uf, lat, lng, status, active)
where s.label = 'f';

select lives_ok($$ select public.support_network_seal_snapshot((select id from s where label = 'f'), 5, 0) $$, 'selado');
select lives_ok($$ select public.support_network_activate_snapshot((select id from s where label = 'f')) $$, 'ativo');

-- 1. Privilegios
select ok(not has_function_privilege('anon', 'public.list_support_municipalities()', 'execute'),
  'anon nao lista municipios');
select ok(not has_function_privilege('anon', 'public.list_support_municipality_types(text)', 'execute'),
  'anon nao lista tipos por municipio');
select ok(has_function_privilege('authenticated', 'public.list_support_municipalities()', 'execute'),
  'authenticated lista municipios');
select is((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
  where oid = 'public.list_support_municipalities()'::regprocedure), true, 'SECURITY DEFINER com search_path vazio');

-- 2. Fixture invisivel por padrao
update public.support_network_settings set fixtures_visible = false;
select pg_temp.as_user();
select is((select count(*)::int from public.list_support_municipalities()), 0, 'fixture invisivel: catalogo vazio');
select is((select count(*)::int from public.list_support_municipality_types('355030')), 0, 'fixture invisivel: sem tipos');
reset role;

update public.support_network_settings set fixtures_visible = true;
select pg_temp.as_user();

-- 3. Catalogo
select is((select count(*)::int from public.list_support_municipalities()), 2,
  '6 e 7 digitos do mesmo municipio viram um item; RJ e outro');
select is((select facility_count from public.list_support_municipalities() where state_code = 'SP'), 3,
  'contagem sem a unidade explicitamente inativa');
select is((select approx_latitude::text || ',' || approx_longitude::text from public.list_support_municipalities()
  where state_code = 'SP'), '-23.56,-46.64',
  'centro aproximado: media so das coordenadas validas e ativas, 2 casas');
select is((select municipality_name from public.list_support_municipalities() order by municipality_name limit 1),
  'Rio de Janeiro', 'ordem alfabetica por nome');

-- 4. Tipos por municipio
select is((select string_agg(official_type_code || ':' || facility_count, ',' order by official_type_code)
  from public.list_support_municipality_types('3550308')), '02:2,70:1', 'tipos presentes com contagem (IBGE 7 digitos)');
select ok((select bool_and(category is null) from public.list_support_municipality_types('355030')),
  'categoria nao confirmada nao aparece');
select throws_ok($$ select * from public.list_support_municipality_types('35') $$, '22023', 'invalid_municipality',
  'municipio invalido recusado');
reset role;

-- 5. Sem autenticacao (sem claims: auth.uid() nulo)
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select * from public.list_support_municipalities() $$, '42501', 'authentication required',
  'sem auth.uid() recusa');

select * from finish();
rollback;
