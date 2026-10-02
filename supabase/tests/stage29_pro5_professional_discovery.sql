-- Stage 29 / PRO-5 - descoberta profissional, contra o banco real.
--
-- Profissionais: V e V2 verificados e publicados; W verificado sem opt-in;
-- P pendente, R recusado, S suspenso e E com revisao vencida, todos
-- "publicados" - e todos precisam ficar FORA. U e T sao leitores comuns.
-- Toda medicao troca de papel de verdade: superusuario ignora RLS.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(47);

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
  ('29500000-0000-4000-8000-000000000001'::uuid, 'pro5-v@elyra.invalid', 'V'),
  ('29500000-0000-4000-8000-000000000002'::uuid, 'pro5-v2@elyra.invalid', 'V2'),
  ('29500000-0000-4000-8000-000000000003'::uuid, 'pro5-w@elyra.invalid', 'W'),
  ('29500000-0000-4000-8000-000000000004'::uuid, 'pro5-p@elyra.invalid', 'P'),
  ('29500000-0000-4000-8000-000000000005'::uuid, 'pro5-r@elyra.invalid', 'R'),
  ('29500000-0000-4000-8000-000000000006'::uuid, 'pro5-s@elyra.invalid', 'S'),
  ('29500000-0000-4000-8000-000000000007'::uuid, 'pro5-e@elyra.invalid', 'E'),
  ('29500000-0000-4000-8000-000000000021'::uuid, 'pro5-u@elyra.invalid', 'U'),
  ('29500000-0000-4000-8000-000000000022'::uuid, 'pro5-t@elyra.invalid', 'T')
) as fixture(id, email, name);

insert into public.professional_profiles (
  user_id, council_region, registration_number, specialty, verification_status,
  verification_reviewed_at, verification_review_due_at
) values
  ('29500000-0000-4000-8000-000000000001', '06', '06/500001', 'Psicologia', 'verified', now() - interval '1 day', now() + interval '365 days'),
  ('29500000-0000-4000-8000-000000000002', '08', '08/500002', 'Psicologia', 'verified', now() - interval '1 day', now() + interval '365 days'),
  ('29500000-0000-4000-8000-000000000003', '06', '06/500003', 'Psicologia', 'verified', now() - interval '1 day', now() + interval '365 days'),
  ('29500000-0000-4000-8000-000000000004', '06', '06/500004', 'Psicologia', 'pending', null, null),
  ('29500000-0000-4000-8000-000000000005', '06', '06/500005', 'Psicologia', 'rejected', now() - interval '1 day', null),
  ('29500000-0000-4000-8000-000000000006', '06', '06/500006', 'Psicologia', 'suspended', now() - interval '1 day', null),
  ('29500000-0000-4000-8000-000000000007', '06', '06/500007', 'Psicologia', 'verified', now() - interval '400 days', now() - interval '35 days');

insert into public.professional_public_profiles
  (user_id, slug, listed, display_name, bio, city, state, modalities, areas, languages)
values
  ('29500000-0000-4000-8000-000000000001', 'aaaaaaaaaaaa0001', true,  'João Vieira', 'Bio V', 'São Paulo', 'SP', '{online,in_person}', '{ansiedade,sono_rotina}', '{pt,es}'),
  ('29500000-0000-4000-8000-000000000002', 'aaaaaaaaaaaa0002', true,  'Ana Vasconcelos', 'Bio V2', 'Recife', 'PE', '{online}', '{luto}', '{pt}'),
  ('29500000-0000-4000-8000-000000000003', 'aaaaaaaaaaaa0003', false, 'Wagner Opt-out', null, 'São Paulo', 'SP', '{online}', '{luto}', '{pt}'),
  ('29500000-0000-4000-8000-000000000004', 'aaaaaaaaaaaa0004', true,  'Paula Pendente', null, 'São Paulo', 'SP', '{online}', '{luto}', '{pt}'),
  ('29500000-0000-4000-8000-000000000005', 'aaaaaaaaaaaa0005', true,  'Rita Recusada', null, 'São Paulo', 'SP', '{online}', '{luto}', '{pt}'),
  ('29500000-0000-4000-8000-000000000006', 'aaaaaaaaaaaa0006', true,  'Sergio Suspenso', null, 'São Paulo', 'SP', '{online}', '{luto}', '{pt}'),
  ('29500000-0000-4000-8000-000000000007', 'aaaaaaaaaaaa0007', true,  'Elisa Expirada', null, 'São Paulo', 'SP', '{online}', '{luto}', '{pt}');

-- Leitura da descoberta como o ator (anon quando nulo).
create function pg_temp.found(p_actor uuid, p_sql text)
returns text[]
language plpgsql
as $$
declare result text[];
begin
  if p_actor is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
  execute format('select coalesce(array_agg(slug order by ord), ''{}'') from (select slug, row_number() over () as ord from (%s) q) r', p_sql)
    into result;
  reset role;
  return result;
end;
$$;

create function pg_temp.as_user(p_actor uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
$$;

-- ---------------------------------------------------------------------------
-- Forma
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.professional_public_profiles'::regclass),
  'perfil publico com RLS'
);
select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'professional_public_profiles' and column_name = 'listed'),
  'false',
  'opt-in nasce desligado'
);
select is(
  pg_get_function_result('public.search_professional_directory(text,text,text,text,text,text,integer,integer)'::regprocedure),
  'TABLE(slug text, display_name text, council text, council_region text, registration_number text, specialty text, verified_at timestamp with time zone, city text, state text, modalities text[], areas text[], languages text[], has_more boolean)',
  'projecao da busca e fixa: nada de user_id, e-mail, documento, reviewer, digest, notas, grants ou vinculos'
);
select is(
  pg_get_function_result('public.get_professional_directory_profile(text)'::regprocedure),
  'TABLE(slug text, display_name text, council text, council_region text, registration_number text, specialty text, verified_at timestamp with time zone, city text, state text, modalities text[], areas text[], languages text[], bio text)',
  'projecao do perfil e fixa'
);
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
   where table_schema = 'public' and table_name = 'professional_directory_access'),
  array['id', 'user_id', 'occurred_at'],
  'vazao guarda so conta e instante, nunca o termo buscado'
);

-- ---------------------------------------------------------------------------
-- Elegibilidade
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select pg_temp.found(null, 'select * from public.search_professional_directory()') $$,
  '42501', null,
  'anon nao usa a descoberta'
);
select is(
  pg_temp.found('29500000-0000-4000-8000-000000000021', 'select * from public.search_professional_directory()'),
  array['aaaaaaaaaaaa0002', 'aaaaaaaaaaaa0001'],
  'verificado + opt-in aparecem, em ordem alfabetica (Ana antes de Joao)'
);
select is(
  pg_temp.found('29500000-0000-4000-8000-000000000021',
    'select * from public.search_professional_directory(p_query => ''wagner'')'), '{}'::text[], 'opt-out: ausente');
select is(
  pg_temp.found('29500000-0000-4000-8000-000000000021',
    'select * from public.search_professional_directory(p_query => ''paula'')'), '{}'::text[], 'pendente: ausente');
select is(
  pg_temp.found('29500000-0000-4000-8000-000000000021',
    'select * from public.search_professional_directory(p_query => ''rita'')'), '{}'::text[], 'recusado: ausente');
select is(
  pg_temp.found('29500000-0000-4000-8000-000000000021',
    'select * from public.search_professional_directory(p_query => ''sergio'')'), '{}'::text[], 'suspenso: ausente');
select is(
  pg_temp.found('29500000-0000-4000-8000-000000000021',
    'select * from public.search_professional_directory(p_query => ''elisa'')'), '{}'::text[], 'revisao vencida: ausente');

select is(
  pg_temp.found('29500000-0000-4000-8000-000000000021',
    'select * from public.get_professional_directory_profile(''aaaaaaaaaaaa0001'')'),
  array['aaaaaaaaaaaa0001'], 'perfil elegivel abre pelo slug');
select is(
  pg_temp.found('29500000-0000-4000-8000-000000000021',
    'select * from public.get_professional_directory_profile(''aaaaaaaaaaaa0006'')'),
  '{}'::text[], 'perfil suspenso nao abre nem pelo slug');
select is(
  pg_temp.found('29500000-0000-4000-8000-000000000021',
    'select * from public.get_professional_directory_profile(''aaaaaaaaaaaa0003'')'),
  '{}'::text[], 'perfil sem opt-in nao abre nem pelo slug');
select is(
  pg_temp.found('29500000-0000-4000-8000-000000000021',
    'select * from public.get_professional_directory_profile(''29500000-0000-4000-8000-000000000001'')'),
  '{}'::text[], 'UUID interno nao e slug');
select is(
  pg_temp.found('29500000-0000-4000-8000-000000000021',
    'select * from public.get_professional_directory_profile(''../aaaaaaaaaaaa0001'')'),
  '{}'::text[], 'slug adulterado: resposta vazia, igual a inexistente');

-- ---------------------------------------------------------------------------
-- Filtros, busca e paginacao
-- ---------------------------------------------------------------------------

select is(pg_temp.found('29500000-0000-4000-8000-000000000021',
  'select * from public.search_professional_directory(p_query => ''joao'')'),
  array['aaaaaaaaaaaa0001'], 'busca sem acento encontra nome com acento');
select is(pg_temp.found('29500000-0000-4000-8000-000000000021',
  'select * from public.search_professional_directory(p_city => ''sao paulo'')'),
  array['aaaaaaaaaaaa0001'], 'cidade normalizada');
select is(pg_temp.found('29500000-0000-4000-8000-000000000021',
  'select * from public.search_professional_directory(p_state => ''PE'')'),
  array['aaaaaaaaaaaa0002'], 'filtro por UF');
select is(pg_temp.found('29500000-0000-4000-8000-000000000021',
  'select * from public.search_professional_directory(p_modality => ''in_person'')'),
  array['aaaaaaaaaaaa0001'], 'filtro por modalidade');
select is(pg_temp.found('29500000-0000-4000-8000-000000000021',
  'select * from public.search_professional_directory(p_area => ''luto'')'),
  array['aaaaaaaaaaaa0002'], 'filtro por area declarada');
select is(pg_temp.found('29500000-0000-4000-8000-000000000021',
  'select * from public.search_professional_directory(p_language => ''es'')'),
  array['aaaaaaaaaaaa0001'], 'filtro por idioma');
select is(pg_temp.found('29500000-0000-4000-8000-000000000021',
  'select * from public.search_professional_directory(p_query => ''%'')'),
  '{}'::text[], 'curinga de LIKE e literal: % nao lista o catalogo');
select is(pg_temp.found('29500000-0000-4000-8000-000000000021',
  'select * from public.search_professional_directory(p_query => ''_'')'),
  '{}'::text[], 'curinga _ tambem e literal');
select is(pg_temp.found('29500000-0000-4000-8000-000000000021',
  'select * from public.search_professional_directory(p_query => ''bio v'')'),
  '{}'::text[], 'busca nao olha a bio (so nome e cidade)');

select pg_temp.as_user('29500000-0000-4000-8000-000000000021');
select is(
  (select array_agg(has_more::text) from public.search_professional_directory(p_page => 1, p_page_size => 1)),
  array['true'], 'pagina 1 de 1 item avisa que ha mais'
);
select is(pg_temp.found('29500000-0000-4000-8000-000000000021',
  'select * from public.search_professional_directory(p_page => 2, p_page_size => 1)'),
  array['aaaaaaaaaaaa0001'], 'pagina 2 traz o seguinte');

select throws_ok(
  $$ select pg_temp.found('29500000-0000-4000-8000-000000000021',
       'select * from public.search_professional_directory(p_page_size => 25)') $$,
  '22023', null, 'pagina maior que 24: recusada');
select throws_ok(
  $$ select pg_temp.found('29500000-0000-4000-8000-000000000021',
       'select * from public.search_professional_directory(p_page => 51)') $$,
  '22023', null, 'alem da pagina 50: recusada');
select throws_ok(
  $$ select pg_temp.found('29500000-0000-4000-8000-000000000021',
       'select * from public.search_professional_directory(p_query => repeat(''a'', 61))') $$,
  '22023', null, 'busca longa demais: recusada');
select throws_ok(
  $$ select pg_temp.found('29500000-0000-4000-8000-000000000021',
       'select * from public.search_professional_directory(p_modality => ''telepatia'')') $$,
  '22023', null, 'modalidade fora da allowlist: recusada');
select throws_ok(
  $$ select pg_temp.found('29500000-0000-4000-8000-000000000021',
       'select * from public.search_professional_directory(p_state => ''sp; drop'')') $$,
  '22023', null, 'UF malformada: recusada');

-- ---------------------------------------------------------------------------
-- RLS do perfil publico
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.as_user('29500000-0000-4000-8000-000000000021');
select is((select count(*)::int from public.professional_public_profiles), 0,
  'leitor comum nao le a tabela (nem perfis publicados)');
update public.professional_public_profiles set bio = 'sequestrada' where user_id = '29500000-0000-4000-8000-000000000001';
select throws_ok(
  $$ insert into public.professional_public_profiles (user_id, display_name) values ('29500000-0000-4000-8000-000000000003', 'Invasor') $$,
  '42501', null, 'ninguem cria perfil publico em nome de outra conta');
select throws_ok(
  $$ select count(*) from public.professional_directory_access $$,
  '42501', null, 'contador de vazao nao e legivel');
select pg_temp.as_user('29500000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.professional_public_profiles), 1, 'dono le o proprio perfil');
select throws_ok(
  $$ update public.professional_public_profiles set slug = 'bbbbbbbbbbbb0001' where user_id = '29500000-0000-4000-8000-000000000001' $$,
  '42501', null, 'slug nao e editavel');
select throws_ok(
  $$ update public.professional_public_profiles set listed = true, city = null where user_id = '29500000-0000-4000-8000-000000000001' $$,
  '23514', null, 'publicar exige perfil completo');
reset role;
select is(
  (select bio from public.professional_public_profiles where user_id = '29500000-0000-4000-8000-000000000001'),
  'Bio V', 'update de terceiro nao altera nada');

-- ---------------------------------------------------------------------------
-- Remocao imediata: opt-out e vencimento valem na proxima consulta
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.as_user('29500000-0000-4000-8000-000000000001');
update public.professional_public_profiles set listed = false where user_id = '29500000-0000-4000-8000-000000000001';
reset role;
select is(pg_temp.found('29500000-0000-4000-8000-000000000021',
  'select * from public.search_professional_directory()'),
  array['aaaaaaaaaaaa0002'], 'opt-out tira da descoberta na proxima consulta');

update public.professional_profiles
set verification_reviewed_at = now() - interval '400 days', verification_review_due_at = now() - interval '1 minute'
where user_id = '29500000-0000-4000-8000-000000000002';
select is(pg_temp.found('29500000-0000-4000-8000-000000000021',
  'select * from public.search_professional_directory()'),
  '{}'::text[], 'revisao vencida tira da descoberta na proxima consulta, sem job');

delete from public.professional_profiles where user_id = '29500000-0000-4000-8000-000000000007';
select is(
  (select count(*)::int from public.professional_public_profiles where user_id = '29500000-0000-4000-8000-000000000007'),
  0, 'apagar o perfil profissional apaga o publico');

-- ---------------------------------------------------------------------------
-- Vazao (anti-scraping) por conta, no banco
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.as_user('29500000-0000-4000-8000-000000000022');
select lives_ok(
  $$ do $loop$ begin
       for i in 1..60 loop perform * from public.search_professional_directory(); end loop;
     end $loop$ $$,
  '60 consultas no minuto passam');
select throws_ok(
  $$ select * from public.search_professional_directory() $$,
  '54000', null, 'a 61a consulta no minuto e recusada');
select throws_ok(
  $$ select * from public.get_professional_directory_profile('aaaaaaaaaaaa0001') $$,
  '54000', null, 'o perfil divide o mesmo balde');
select pg_temp.as_user('29500000-0000-4000-8000-000000000021');
select lives_ok(
  $$ select * from public.search_professional_directory() $$,
  'o balde e por conta: outra pessoa segue consultando');
reset role;

select * from finish();
rollback;
