-- Stage 29 / Verificacao profissional V2 (ADR-0028).
--
-- Prova: evidencia so pelo executor confiavel; profissional nao grava nem le a
-- propria evidencia crua; decisao automatica so com os 7 gates PROVADOS por
-- fonte aceita, fresca, da submissao corrente; fixture so com interruptor
-- local; recusa so por incompatibilidade provada; replay e sinal de seguranca
-- bloqueiam; bruto nunca retido.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(55);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('29a00000-0000-4000-8000-000000000001', 'v2-a@elyra.invalid', now(), '{"display_name":"Pro A"}'),
  ('29a00000-0000-4000-8000-000000000002', 'v2-b@elyra.invalid', now(), '{"display_name":"Pro B"}'),
  ('29a00000-0000-4000-8000-000000000003', 'v2-r@elyra.invalid', now(), '{"display_name":"Revisora"}');

insert into public.professional_profiles (user_id, council_region, registration_number, specialty, verification_status)
values
  ('29a00000-0000-4000-8000-000000000001', '06', '123456', 'Psicologia', 'pending'),
  ('29a00000-0000-4000-8000-000000000002', '06', '654381', 'Psicologia', 'pending');

insert into public.professional_onboarding (user_id, identity_confirmed_at, draft_council_region,
  draft_registration_number, draft_specialty, submitted_at, submission_count, precheck_submission)
values
  ('29a00000-0000-4000-8000-000000000001', now(), '06', '123456', 'Psicologia', now(), 1, 0),
  ('29a00000-0000-4000-8000-000000000002', now(), '06', '654381', 'Psicologia', now(), 1, 0);

create or replace function pg_temp.as_user(p_id uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated', 'aal', p_aal)::text, true);
end;
$$;

create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin
  execute 'set local role service_role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end;
$$;

-- Evidencia completa (7 gates) para uma pessoa, com fonte e assurance dados.
create or replace function pg_temp.full_batch(p_registry_source text, p_identity_source text, p_assurance text)
returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('fact_type','auth_account','source_type','local_evidence','provider','elyra_session','status','PASS','policy_version','stage29.v2'),
    jsonb_build_object('fact_type','required_terms','source_type','local_evidence','provider','elyra_onboarding','status','PASS','policy_version','stage29.v2'),
    jsonb_build_object('fact_type','registry_format','source_type','local_evidence','provider','elyra_onboarding','status','PASS','policy_version','stage29.v2'),
    jsonb_build_object('fact_type','identity_match','source_type',p_identity_source,'provider','qa_identity','status','PASS','assurance',p_assurance,'policy_version','stage29.v2'),
    jsonb_build_object('fact_type','professional_registry','source_type',p_registry_source,'provider','qa_registry','status','PASS','value_digest',repeat('a',64),'policy_version','stage29.v2'),
    jsonb_build_object('fact_type','registry_holder_match','source_type',p_registry_source,'provider','qa_registry','status','PASS','policy_version','stage29.v2'),
    jsonb_build_object('fact_type','registry_status','source_type',p_registry_source,'provider','qa_registry','status','PASS','policy_version','stage29.v2')
  );
$$;

-- 1. Superficie ---------------------------------------------------------------------

select ok((select relforcerowsecurity from pg_class where oid = 'public.professional_verification_evidence'::regclass),
  'evidencia com RLS forcada');
select ok(not has_table_privilege('authenticated', 'public.professional_verification_evidence', 'SELECT')
  and not has_table_privilege('authenticated', 'public.professional_verification_evidence', 'INSERT'),
  'usuario nao le nem grava evidencia direto');
select ok(not has_function_privilege('authenticated', 'public.record_verification_evidence_for(uuid, integer, jsonb)', 'EXECUTE'),
  'usuario nao chama o gravador de evidencia');
select ok(not has_function_privilege('authenticated', 'public.apply_automated_verification_for(uuid, integer, text, text)', 'EXECUTE'),
  'usuario nao chama a decisao automatica');
select ok(not has_function_privilege('anon', 'public.list_my_verification_evidence()', 'EXECUTE'), 'anon nao le projecao');
select ok(not has_table_privilege('authenticated', 'public.professional_verification_settings', 'SELECT')
  and not has_table_privilege('authenticated', 'public.professional_verification_settings', 'UPDATE'),
  'usuario nao ve nem liga o interruptor de fixture');
select is((select accept_fixture_evidence from public.professional_verification_settings), false,
  'fixture nao decide por padrao');
select ok(not has_table_privilege('authenticated', 'public.education_registry_courses', 'SELECT'),
  'snapshot e-MEC so no servidor');

-- 2. Profissional tenta aprovar a si mesmo ------------------------------------------

select pg_temp.as_user('29a00000-0000-4000-8000-000000000001');
select throws_ok($$ select public.record_verification_evidence_for('29a00000-0000-4000-8000-000000000001', 1,
  pg_temp.full_batch('official_registry', 'official_registry', 'identity_strongly_verified')) $$,
  '42501', null, 'profissional nao grava evidencia (forged VERIFIED)');
select throws_ok($$ select public.apply_automated_verification_for('29a00000-0000-4000-8000-000000000001', 1, 'verified', 'stage29.v2') $$,
  '42501', null, 'profissional nao dispara a propria aprovacao');
select throws_ok($$ insert into public.professional_verifications (professional_user_id, from_status, to_status,
  reason_code, source, evidence_digest, actor_role, review_due_at)
  values ('29a00000-0000-4000-8000-000000000001', 'pending', 'verified', 'registry_active_confirmed',
  'elyra_automated_verification', repeat('b', 64), 'system', now() + interval '10 days') $$,
  '42501', null, 'nem inserindo direto na trilha');
reset role;

-- 3. Sem evidencia, nada aprova -------------------------------------------------------

select pg_temp.as_service();
select throws_like($$ select public.apply_automated_verification_for('29a00000-0000-4000-8000-000000000001', 1, 'verified', 'stage29.v2') $$,
  'mandatory evidence not proven%', 'sem evidencia: nao aprova');
select throws_ok($$ select public.record_verification_evidence_for('29a00000-0000-4000-8000-000000000001', 7,
  pg_temp.full_batch('official_registry', 'official_registry', 'identity_strongly_verified')) $$,
  '22023', 'evidence replay', 'evidencia de outra submissao: recusa');
select throws_ok($$ select public.record_verification_evidence_for('29a00000-0000-4000-8000-000000000001', 1, '[]'::jsonb) $$,
  '22023', 'invalid evidence batch', 'lote vazio: recusa');

-- 4. Fonte fraca nao conta -------------------------------------------------------------

-- Registro "confirmado" por evidencia local (ex.: o proprio formulario): nao vale.
select is(public.record_verification_evidence_for('29a00000-0000-4000-8000-000000000001', 1,
  pg_temp.full_batch('local_evidence', 'official_registry', 'identity_strongly_verified')), 7, 'lote gravado');
select throws_like($$ select public.apply_automated_verification_for('29a00000-0000-4000-8000-000000000001', 1, 'verified', 'stage29.v2') $$,
  'mandatory evidence not proven: professional_registry', 'registro so por fonte local: nao aprova');

-- Identidade so declarada (a baseline gratuita de hoje): nao vale.
select is(public.record_verification_evidence_for('29a00000-0000-4000-8000-000000000001', 1,
  pg_temp.full_batch('official_registry', 'local_evidence', 'identity_declared')), 7, 'lote gravado');
select throws_like($$ select public.apply_automated_verification_for('29a00000-0000-4000-8000-000000000001', 1, 'verified', 'stage29.v2') $$,
  'mandatory evidence not proven: identity_match', 'identidade declarada: nao aprova');

-- Fixture de QA com o interruptor desligado: nao vale.
select is(public.record_verification_evidence_for('29a00000-0000-4000-8000-000000000001', 1,
  pg_temp.full_batch('qa_fixture', 'qa_fixture', 'identity_document_crosschecked')), 7, 'lote de fixture gravado');
select throws_like($$ select public.apply_automated_verification_for('29a00000-0000-4000-8000-000000000001', 1, 'verified', 'stage29.v2') $$,
  'mandatory evidence not proven%', 'fixture com interruptor desligado: nao aprova');

-- Evidencia velha (mais de 24 h) nao decide.
select is(public.record_verification_evidence_for('29a00000-0000-4000-8000-000000000002', 1,
  pg_temp.full_batch('official_registry', 'official_registry', 'identity_strongly_verified')), 7, 'lote de B gravado');
reset role;
update public.professional_verification_evidence set checked_at = now() - interval '2 days'
where professional_user_id = '29a00000-0000-4000-8000-000000000002';
select pg_temp.as_service();
select throws_like($$ select public.apply_automated_verification_for('29a00000-0000-4000-8000-000000000002', 1, 'verified', 'stage29.v2') $$,
  'mandatory evidence not proven%', 'evidencia com mais de 24 h: nao aprova');
reset role;

-- 5. Com prova completa por fonte aceita, aprova — uma vez ------------------------------

delete from public.professional_verification_evidence where professional_user_id = '29a00000-0000-4000-8000-000000000001';
select pg_temp.as_service();
select is(public.record_verification_evidence_for('29a00000-0000-4000-8000-000000000001', 1,
  pg_temp.full_batch('official_registry', 'optional_provider', 'identity_strongly_verified')), 7, 'prova completa gravada');
-- Empate no mesmo instante: um FAIL junto com o PASS vence.
select is(public.record_verification_evidence_for('29a00000-0000-4000-8000-000000000001', 1, jsonb_build_array(
  jsonb_build_object('fact_type','registry_status','source_type','official_registry','provider','qa_registry',
    'status','FAIL','detail','registry_inactive','checked_at',
    (select max(checked_at) from public.professional_verification_evidence
     where professional_user_id = '29a00000-0000-4000-8000-000000000001' and fact_type = 'registry_status')::text,
    'policy_version','stage29.v2'))), 1, 'FAIL no mesmo instante');
select throws_like($$ select public.apply_automated_verification_for('29a00000-0000-4000-8000-000000000001', 1, 'verified', 'stage29.v2') $$,
  'mandatory evidence not proven: registry_status', 'PASS nao mascara FAIL empatado');
reset role;
delete from public.professional_verification_evidence
where professional_user_id = '29a00000-0000-4000-8000-000000000001' and status = 'FAIL';

select pg_temp.as_service();
select is(public.apply_automated_verification_for('29a00000-0000-4000-8000-000000000001', 1, 'verified', 'stage29.v2'),
  'verified', 'sete gates provados por fonte aceita: VERIFIED');
select throws_ok($$ select public.apply_automated_verification_for('29a00000-0000-4000-8000-000000000001', 1, 'verified', 'stage29.v2') $$,
  '22023', 'automated decision replay', 'repetir a decisao: replay');
reset role;

select is((select verification_status from public.professional_profiles where user_id = '29a00000-0000-4000-8000-000000000001'),
  'verified', 'perfil verificado');
select ok((select verification_review_due_at <= now() + interval '181 days' and verification_review_due_at > now()
  from public.professional_profiles where user_id = '29a00000-0000-4000-8000-000000000001'),
  'reverificacao em ate 180 dias');
select is((select count(*)::int from public.professional_verifications
  where professional_user_id = '29a00000-0000-4000-8000-000000000001'
    and source = 'elyra_automated_verification' and actor_role = 'system'
    and evidence_digest ~ '^[0-9a-f]{64}$' and actor_user_id is null), 1,
  'trilha: sistema, fonte automatizada, digest da prova, sem pessoa');
select is((select precheck_submission from public.professional_onboarding
  where user_id = '29a00000-0000-4000-8000-000000000001'), 1, 'precheck antigo nao pode mais sobrescrever');
select is((select count(*)::int from public.notifications where user_id = '29a00000-0000-4000-8000-000000000001'
  and kind = 'professional_verification_update'), 1, 'profissional avisado sem conteudo');

-- 6. Recusa so com incompatibilidade provada --------------------------------------------

delete from public.professional_verification_evidence where professional_user_id = '29a00000-0000-4000-8000-000000000002';
select pg_temp.as_service();
select is(public.record_verification_evidence_for('29a00000-0000-4000-8000-000000000002', 1, jsonb_build_array(
  jsonb_build_object('fact_type','registry_status','source_type','official_registry','provider','qa_registry',
    'status','FAIL','detail','registry_inactive','policy_version','stage29.v2'))), 1, 'registro inativo');
select throws_ok($$ select public.apply_automated_verification_for('29a00000-0000-4000-8000-000000000002', 1, 'rejected', 'stage29.v2') $$,
  '22023', 'rejection not proven', 'inativo sem titular confirmado: nao recusa (pode ser o registro errado)');
select is(public.record_verification_evidence_for('29a00000-0000-4000-8000-000000000002', 1, jsonb_build_array(
  jsonb_build_object('fact_type','registry_holder_match','source_type','official_registry','provider','qa_registry',
    'status','PASS','policy_version','stage29.v2'))), 1, 'titular confere');
select is(public.apply_automated_verification_for('29a00000-0000-4000-8000-000000000002', 1, 'rejected', 'stage29.v2'),
  'rejected', 'mesmo titular + inativo em fonte oficial: REJECTED');
reset role;

-- 7. Sinal de seguranca, fixture local, constraints --------------------------------------

update public.professional_profiles set verification_status = 'pending' where user_id = '29a00000-0000-4000-8000-000000000002';
update public.professional_onboarding set submission_count = 2 where user_id = '29a00000-0000-4000-8000-000000000002';
update public.professional_verification_settings set accept_fixture_evidence = true;
select pg_temp.as_service();
select is(public.record_verification_evidence_for('29a00000-0000-4000-8000-000000000002', 2,
  pg_temp.full_batch('qa_fixture', 'qa_fixture', 'identity_document_crosschecked')), 7, 'fixture completa');
select is(public.record_verification_evidence_for('29a00000-0000-4000-8000-000000000002', 2, jsonb_build_array(
  jsonb_build_object('fact_type','registry_format','source_type','local_evidence','provider','elyra_onboarding',
    'status','REPLAY','policy_version','stage29.v2'))), 1, 'sinal de replay');
select throws_like($$ select public.apply_automated_verification_for('29a00000-0000-4000-8000-000000000002', 2, 'verified', 'stage29.v2') $$,
  'automated decision blocked by security signal', 'sinal de seguranca: nunca decide sozinho');
reset role;
delete from public.professional_verification_evidence
where professional_user_id = '29a00000-0000-4000-8000-000000000002' and status = 'REPLAY';
select pg_temp.as_service();
select is(public.apply_automated_verification_for('29a00000-0000-4000-8000-000000000002', 2, 'verified', 'stage29.v2'),
  'verified', 'interruptor local ligado: fixture decide (so QA local)');
reset role;
update public.professional_verification_settings set accept_fixture_evidence = false;

select throws_ok($$ insert into public.professional_verification_evidence (professional_user_id, submission, fact_type,
  source_type, provider, status, policy_version, raw_evidence_retained)
  values ('29a00000-0000-4000-8000-000000000001', 1, 'education', 'official_open_data', 'emec_snapshot', 'PASS', 'stage29.v2', true) $$,
  '23514', null, 'bruto nunca retido');
select throws_ok($$ insert into public.professional_verification_evidence (professional_user_id, submission, fact_type,
  source_type, provider, status, policy_version, assurance)
  values ('29a00000-0000-4000-8000-000000000001', 1, 'education', 'official_open_data', 'emec_snapshot', 'PASS', 'stage29.v2', 'authenticated') $$,
  '23514', null, 'assurance so no fato de identidade');
select throws_ok($$ insert into public.professional_verification_evidence (professional_user_id, submission, fact_type,
  source_type, provider, status, policy_version, detail)
  values ('29a00000-0000-4000-8000-000000000001', 1, 'education', 'official_open_data', 'emec_snapshot', 'PASS', 'stage29.v2', 'Maria da Silva CPF 123') $$,
  '23514', null, 'detalhe nunca e texto livre');
select throws_ok($$ insert into public.professional_verifications (professional_user_id, from_status, to_status,
  reason_code, source, evidence_digest, actor_role, actor_user_id, review_due_at)
  values ('29a00000-0000-4000-8000-000000000001', 'pending', 'verified', 'registry_active_confirmed',
  'elyra_automated_verification', repeat('b', 64), 'reviewer', '29a00000-0000-4000-8000-000000000003', now() + interval '1 day') $$,
  '23514', null, 'fonte automatizada nunca com pessoa como ator');

-- 8. Projecoes ------------------------------------------------------------------------------

select pg_temp.as_user('29a00000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.list_my_verification_evidence()), 7, 'dono ve um estado por fato');
select is((select source_category from public.list_my_verification_evidence() where fact_type = 'professional_registry'),
  'official', 'dono ve o TIPO de fonte, nao o provider');
select throws_ok($$ select * from public.list_verification_evidence_for_review('29a00000-0000-4000-8000-000000000002') $$,
  '42501', 'reviewer required', 'profissional nao le evidencia alheia');
reset role;
insert into public.professional_reviewers (user_id, active, granted_by) values
  ('29a00000-0000-4000-8000-000000000003', true, 'pgtap-v2');
select pg_temp.as_user('29a00000-0000-4000-8000-000000000003', 'aal1');
select throws_ok($$ select * from public.list_verification_evidence_for_review('29a00000-0000-4000-8000-000000000002') $$,
  '42501', 'reviewer mfa required', 'reviewer sem aal2: recusa');
reset role;

-- 9. Projecao publica "Identidade" (so booleano) ----------------------------------------

update public.professional_profiles set verification_status = 'verified',
  verification_reviewed_at = now() - interval '1 day', verification_review_due_at = now() + interval '100 days'
where user_id = '29a00000-0000-4000-8000-000000000002';
insert into public.professional_public_profiles (user_id, slug, listed, display_name, city, state, modalities, areas, languages)
values ('29a00000-0000-4000-8000-000000000002', 'd29a000000000002', true, 'Pro B', 'Recife', 'PE', '{online}', '{ansiedade}', '{pt}');
select pg_temp.as_user('29a00000-0000-4000-8000-000000000003');
select is(public.professional_directory_identity_verified('d29a000000000002'), false,
  'identidade de fixture de QA nunca aparece como verificada no perfil publico');
reset role;
select pg_temp.as_service();
select is(public.record_verification_evidence_for('29a00000-0000-4000-8000-000000000002', 2, jsonb_build_array(
  jsonb_build_object('fact_type','identity_match','source_type','local_evidence','provider','elyra_local_identity',
    'status','UNVERIFIED','assurance','identity_declared','policy_version','stage29.v2'))), 1, 'identidade so declarada, mais recente');
reset role;
select pg_temp.as_user('29a00000-0000-4000-8000-000000000003');
select is(public.professional_directory_identity_verified('d29a000000000002'), false, 'declarada: nao aparece');
reset role;
select pg_temp.as_service();
select is(public.record_verification_evidence_for('29a00000-0000-4000-8000-000000000002', 2, jsonb_build_array(
  jsonb_build_object('fact_type','identity_match','source_type','optional_provider','provider','qa_identity',
    'status','PASS','assurance','identity_strongly_verified','policy_version','stage29.v2'))), 1, 'identidade forte, mais recente');
reset role;
select pg_temp.as_user('29a00000-0000-4000-8000-000000000003');
select is(public.professional_directory_identity_verified('d29a000000000002'), true, 'conferida por fonte real: aparece');
select is(public.professional_directory_identity_verified('nao-e-slug'), false, 'slug invalido: false');
reset role;
set local role anon;
select throws_ok($$ select public.professional_directory_identity_verified('d29a000000000002') $$, '42501', null,
  'anonimo nao consulta');
reset role;

select * from finish();
rollback;
