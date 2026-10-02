-- Stage 29 / F5 - perfil de confianca: conferencia de credencial e projecao
-- publica factual, com identidade real.
--
-- Atores: P (profissional verificado e listado), R (reviewer aal2), V (leitor
-- autenticado), Q (profissional pendente e listado).

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

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
  ('29f50000-0000-4000-8000-000000000001'::uuid, 'f5-p@elyra.invalid', 'Profissional P'),
  ('29f50000-0000-4000-8000-000000000002'::uuid, 'f5-r@elyra.invalid', 'Reviewer R'),
  ('29f50000-0000-4000-8000-000000000003'::uuid, 'f5-v@elyra.invalid', 'Leitora V'),
  ('29f50000-0000-4000-8000-000000000004'::uuid, 'f5-q@elyra.invalid', 'Pendente Q')
) as fixture(id, email, name);

insert into public.professional_reviewers (user_id, granted_by)
values ('29f50000-0000-4000-8000-000000000002', 'pgtap-fixture');

insert into public.professional_profiles (
  user_id, council_region, registration_number, specialty, verification_status,
  verification_reviewed_at, verification_review_due_at
) values
  ('29f50000-0000-4000-8000-000000000001', '06', 'F5-111111', 'Psicologia', 'verified',
   now() - interval '1 day', now() + interval '300 days'),
  ('29f50000-0000-4000-8000-000000000004', '06', 'F5-222222', 'Psicologia', 'pending', null, null);

insert into public.professional_public_profiles (
  user_id, slug, listed, display_name, city, state, modalities, areas, languages
) values
  ('29f50000-0000-4000-8000-000000000001', 'f5f5f5f5f5f5f501', true, 'P Publica', 'Curitiba', 'PR',
   array['online'], array['ansiedade'], array['pt']),
  ('29f50000-0000-4000-8000-000000000004', 'f5f5f5f5f5f5f504', true, 'Q Publica', 'Curitiba', 'PR',
   array['online'], array['ansiedade'], array['pt']);

insert into public.professional_credentials (id, user_id, kind, title, institution, start_year, end_year, expires_on)
values
  ('29f50000-0000-4000-8000-0000000000c1', '29f50000-0000-4000-8000-000000000001', 'education', 'Psicologia', 'Univ X', 2010, 2015, null),
  ('29f50000-0000-4000-8000-0000000000c2', '29f50000-0000-4000-8000-000000000001', 'certification', 'Cert vencida', 'Emissor', null, null, current_date - 1),
  ('29f50000-0000-4000-8000-0000000000c3', '29f50000-0000-4000-8000-000000000001', 'experience', 'Clinica', 'Org', 2016, null, null),
  ('29f50000-0000-4000-8000-0000000000c4', '29f50000-0000-4000-8000-000000000004', 'education', 'Psicologia', 'Univ Y', 2012, 2017, null);

select ok(
  not has_function_privilege('anon', 'public.list_professional_directory_credentials(text)', 'EXECUTE'),
  'anon nao le credenciais publicas'
);
select ok(
  not exists (
    select 1 from pg_proc p
    where p.proname = 'list_professional_directory_credentials'
      and (p.proargnames && array['evidence_digest', 'verification_source', 'user_id', 'policy_version', 'id'])
  ),
  'projecao publica nao expoe digest, fonte, politica, id nem user_id'
);

-- ---------------------------------------------------------------------------
-- Conferencia so por reviewer aal2, nunca por si mesmo
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"29f50000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.review_professional_credential('29f50000-0000-4000-8000-0000000000c1', true, 'issuer_manual', repeat('a', 64))$$,
  '42501', null,
  'profissional nao confere a propria credencial'
);
select throws_ok(
  $$update public.professional_credentials set trust_state = 'verified' where id = '29f50000-0000-4000-8000-0000000000c1'$$,
  '42501', null,
  'nem por update direto'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"29f50000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.review_professional_credential('29f50000-0000-4000-8000-0000000000c1', true, 'issuer_manual', repeat('a', 64))$$,
  '42501', 'reviewer mfa required',
  'reviewer sem aal2 nao confere'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"29f50000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select ok(
  (select count(*) = 4 from public.list_professional_credential_queue()
   where professional_user_id in ('29f50000-0000-4000-8000-000000000001', '29f50000-0000-4000-8000-000000000004')),
  'fila mostra credenciais declaradas de terceiros'
);
select throws_ok(
  $$select public.review_professional_credential('29f50000-0000-4000-8000-0000000000c1', true, 'linkedin', repeat('a', 64))$$,
  '22023', 'invalid credential source',
  'fonte fora do catalogo e recusada'
);
select throws_ok(
  $$select public.review_professional_credential('29f50000-0000-4000-8000-0000000000c1', true, 'issuer_manual', 'nao-e-digest')$$,
  '22023', 'invalid evidence digest',
  'conferencia exige digest sha256'
);
select lives_ok(
  $$select public.review_professional_credential('29f50000-0000-4000-8000-0000000000c1', true, 'document_manual', repeat('b', 64))$$,
  'reviewer confere a formacao'
);
reset role;

select results_eq(
  $$select trust_state, verification_source, policy_version from public.professional_credentials where id = '29f50000-0000-4000-8000-0000000000c1'$$,
  $$values ('verified'::text, 'document_manual'::text, 'stage29.f5.v1'::text)$$,
  'credencial verificada com fonte e politica'
);
select ok(
  exists (select 1 from public.audit_logs where action = 'professional_credential.verified'
          and entity_id = '29f50000-0000-4000-8000-0000000000c1'),
  'conferencia auditada'
);

-- ---------------------------------------------------------------------------
-- Projecao publica
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"29f50000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$select kind, title, trust_state from public.list_professional_directory_credentials('f5f5f5f5f5f5f501')$$,
  $$values ('education'::text, 'Psicologia'::text, 'verified'::text),
           ('experience'::text, 'Clinica'::text, 'declared'::text)$$,
  'leitor ve fatos em ordem fixa; certificacao vencida fora; declarado e verificado distintos'
);
select is(
  (select count(*)::integer from public.list_professional_directory_credentials('f5f5f5f5f5f5f504')),
  0,
  'perfil sem verificacao vigente nao expoe credenciais, mesmo listado'
);
select is(
  (select count(*)::integer from public.list_professional_directory_credentials('nao-e-slug')),
  0,
  'slug malformado: vazio'
);
select is(
  (select count(*)::integer from public.professional_credentials),
  0,
  'leitor nao le a tabela direto'
);
reset role;

-- Editar item verificado o devolve a declarado (vale para a vitrine tambem)
select set_config('request.jwt.claims', '{"sub":"29f50000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
update public.professional_credentials set title = 'Psicologia (bacharelado)' where id = '29f50000-0000-4000-8000-0000000000c1';
select is(
  (select trust_state from public.professional_credentials where id = '29f50000-0000-4000-8000-0000000000c1'),
  'declared',
  'editar invalida a conferencia'
);
select is(
  (select evidence_digest from public.professional_credentials where id = '29f50000-0000-4000-8000-0000000000c1'),
  null,
  'e apaga o digest'
);
reset role;

-- Reviewer desfaz conferencia
update public.professional_credentials
set trust_state = 'verified', verified_at = now(), evidence_digest = repeat('c', 64),
    verification_source = 'issuer_manual', policy_version = 'pgtap'
where id = '29f50000-0000-4000-8000-0000000000c3';
select set_config('request.jwt.claims', '{"sub":"29f50000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.review_professional_credential('29f50000-0000-4000-8000-0000000000c3', false)$$,
  'reviewer desfaz conferencia'
);
reset role;
select is(
  (select trust_state from public.professional_credentials where id = '29f50000-0000-4000-8000-0000000000c3'),
  'declared',
  'desfeita volta a declarada'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'professional_public_profiles'
      and column_name ~ '(rating|score|stars|rank|recommend)'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'professional_credentials'
      and column_name ~ '(rating|score|stars|rank|recommend)'
  ),
  'nenhuma coluna de nota, ranking ou recomendacao'
);

select * from finish();
rollback;
