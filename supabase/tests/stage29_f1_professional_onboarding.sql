-- Stage 29 / F1-F3 - onboarding, credenciais declaradas, pre-checagem e
-- pedido de correcao, provados por comportamento com identidade real.
--
-- Atores: P (novo profissional), R (reviewer aal2), X (outra conta), S
-- (profissional que sera suspenso).

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(48);

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
  ('29f10000-0000-4000-8000-000000000001'::uuid, 'f1-p@elyra.invalid', 'Profissional P'),
  ('29f10000-0000-4000-8000-000000000002'::uuid, 'f1-r@elyra.invalid', 'Reviewer R'),
  ('29f10000-0000-4000-8000-000000000003'::uuid, 'f1-x@elyra.invalid', 'Outra X')
) as fixture(id, email, name);

insert into public.professional_reviewers (user_id, granted_by)
values ('29f10000-0000-4000-8000-000000000002', 'pgtap-fixture');

-- ---------------------------------------------------------------------------
-- Forma
-- ---------------------------------------------------------------------------

select ok((select relrowsecurity and relforcerowsecurity from pg_class
           where oid = 'public.professional_onboarding'::regclass), 'onboarding usa RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class
           where oid = 'public.professional_credentials'::regclass), 'credenciais usam RLS forcada');
select ok(
  not has_table_privilege('anon', 'public.professional_onboarding', 'SELECT')
  and not has_table_privilege('anon', 'public.professional_credentials', 'SELECT')
  and not has_table_privilege('service_role', 'public.professional_onboarding', 'SELECT')
  and not has_table_privilege('service_role', 'public.professional_credentials', 'UPDATE'),
  'anon e service_role sem acesso direto'
);
select ok(
  not has_column_privilege('authenticated', 'public.professional_onboarding', 'submission_count', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.professional_onboarding', 'submitted_at', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.professional_onboarding', 'precheck_submission', 'UPDATE'),
  'contadores do envio nao sao graváveis pelo cliente'
);
select ok(
  not has_column_privilege('authenticated', 'public.professional_credentials', 'trust_state', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.professional_credentials', 'trust_state', 'INSERT')
  and not has_column_privilege('authenticated', 'public.professional_credentials', 'verified_at', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.professional_credentials', 'evidence_digest', 'INSERT'),
  'cliente nao escreve estado de confianca nem evidencia'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('professional_onboarding', 'professional_credentials')
      and column_name ~ '(cpf|rg|document|address|endereco|birth)'
  ),
  'sem CPF, RG, documento, endereco ou nascimento no schema novo'
);
select ok(
  not has_function_privilege('authenticated', 'public.professional_verification_notify(uuid)', 'EXECUTE'),
  'notificacao de verificacao nao e chamavel pelo cliente'
);

-- ---------------------------------------------------------------------------
-- ONBOARDING: rascunho proprio, retomavel
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"29f10000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$select * from public.submit_professional_onboarding()$$,
  '22023', 'onboarding required',
  'sem rascunho nao ha envio'
);
select lives_ok(
  $$insert into public.professional_onboarding (user_id, current_step) values (auth.uid(), 'registro')$$,
  'profissional cria o proprio rascunho'
);
select throws_ok(
  $$insert into public.professional_onboarding (user_id) values ('29f10000-0000-4000-8000-000000000003')$$,
  '42501', null,
  'ninguem cria rascunho em nome de outra conta'
);
select throws_ok(
  $$update public.professional_onboarding set submission_count = 9 where user_id = auth.uid()$$,
  '42501', null,
  'contador de envio nao e editavel'
);
select throws_ok(
  $$update public.professional_onboarding set current_step = 'admin' where user_id = auth.uid()$$,
  '23514', null,
  'etapa fora do catalogo e recusada'
);
select lives_ok(
  $$update public.professional_onboarding
    set draft_council_region = '06', draft_registration_number = '06/777777',
        draft_specialty = 'Psicologia clinica', completed_steps = array['inicio','registro']
    where user_id = auth.uid()$$,
  'rascunho do registro salvo'
);
select throws_ok(
  $$select * from public.submit_professional_onboarding()$$,
  '22023', 'identity confirmation required',
  'sem confirmar identidade nao envia'
);
select lives_ok(
  $$update public.professional_onboarding set identity_confirmed_at = '2000-01-01' where user_id = auth.uid()$$,
  'confirma identidade'
);
select ok(
  (select identity_confirmed_at > timezone('utc', now()) - interval '1 minute'
   from public.professional_onboarding where user_id = auth.uid()),
  'horario da confirmacao e do servidor, nao do cliente'
);
select is(
  (select count(*)::integer from public.professional_profiles where user_id = auth.uid()),
  0,
  'rascunho nao cria perfil profissional'
);

-- Credenciais declaradas
select lives_ok(
  $$insert into public.professional_credentials (user_id, kind, title, institution, start_year, end_year)
    values (auth.uid(), 'education', 'Psicologia', 'Universidade X', 2010, 2015)$$,
  'declara formacao'
);
select throws_ok(
  $$insert into public.professional_credentials (user_id, kind, title, institution, trust_state)
    values (auth.uid(), 'certification', 'Cert', 'Emissor', 'verified')$$,
  '42501', null,
  'nao se auto-declara verificado'
);
select throws_ok(
  $$insert into public.professional_credentials (user_id, kind, title, institution, start_year, end_year)
    values (auth.uid(), 'experience', 'Clinica', 'Org', 2020, 2010)$$,
  '23514', null,
  'periodo invertido e recusado'
);
select throws_ok(
  $$insert into public.professional_credentials (user_id, kind, title, institution)
    values ('29f10000-0000-4000-8000-000000000003', 'education', 'Psicologia', 'Univ')$$,
  '42501', null,
  'ninguem declara credencial por outra conta'
);

-- Envio
select results_eq(
  $$select verification_status, submission from public.submit_professional_onboarding()$$,
  $$values ('pending'::text, 1)$$,
  'envio cria o perfil em pending (UNDER_AUTOMATED_REVIEW), envio 1'
);
select is(
  (select count(*)::integer from public.notifications
   where user_id = auth.uid() and kind = 'professional_verification_update'),
  1,
  'envio avisa o profissional pela infraestrutura 29-C'
);

-- Pre-checagem: so dois desfechos, uma vez por envio
select throws_ok(
  $$select public.record_professional_precheck(1, 'verified', 'registry_active_confirmed')$$,
  '22023', 'invalid precheck outcome',
  'pre-checagem nunca aprova'
);
select throws_ok(
  $$select public.record_professional_precheck(1, 'rejected', 'registry_not_found')$$,
  '22023', 'invalid precheck outcome',
  'pre-checagem nunca rejeita'
);
select throws_ok(
  $$select public.record_professional_precheck(2, 'manual_hold', 'automated_precheck_manual_hold')$$,
  '22023', 'precheck replay',
  'envio que nao existe e recusado'
);
select is(
  public.record_professional_precheck(1, 'manual_hold', 'automated_precheck_manual_hold'),
  'pending',
  'manual hold mantem na fila'
);
select throws_ok(
  $$select public.record_professional_precheck(1, 'needs_correction', 'name_mismatch')$$,
  '22023', 'precheck replay',
  'replay da pre-checagem do mesmo envio e recusado'
);
select ok(
  (select count(*) = 1 from public.list_my_professional_verification_events()
   where reason_code = 'automated_precheck_manual_hold' and actor_role = 'system'),
  'trilha registra o manual hold como sistema'
);

reset role;

-- X nao ve nada de P
select set_config('request.jwt.claims', '{"sub":"29f10000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::integer from public.professional_onboarding), 0, 'X nao le rascunho de P');
select is((select count(*)::integer from public.professional_credentials), 0, 'X nao le credenciais de P');
select is(
  (select count(*)::integer from public.professional_credentials where user_id = '29f10000-0000-4000-8000-000000000001'),
  0,
  'nem filtrando pelo id'
);
reset role;

-- ---------------------------------------------------------------------------
-- Reviewer: pedido de correcao (nunca recusa por ambiguidade)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"29f10000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.review_professional_verification('29f10000-0000-4000-8000-000000000001', 'under_review', 'review_started', 'elyra_workflow')$$,
  'reviewer abre a revisao'
);
select throws_ok(
  $$select public.review_professional_verification('29f10000-0000-4000-8000-000000000001', 'rejected', 'name_mismatch', 'elyra_workflow')$$,
  '22023', null,
  'divergencia de nome nao vira recusa'
);
select lives_ok(
  $$select public.review_professional_verification('29f10000-0000-4000-8000-000000000001', 'needs_correction', 'name_mismatch', 'elyra_workflow')$$,
  'divergencia vira pedido de correcao'
);
select throws_ok(
  $$select public.review_professional_verification('29f10000-0000-4000-8000-000000000001', 'verified', 'registry_active_confirmed', 'cfp_cadastro_nacional_manual', repeat('a', 64), 365)$$,
  '22023', null,
  'nao se aprova direto de needs_correction'
);
reset role;

select is(
  (select verification_status from public.professional_profiles where user_id = '29f10000-0000-4000-8000-000000000001'),
  'needs_correction',
  'estado PENDING_CORRECTION'
);
select is(
  (select count(*)::integer from public.notifications
   where user_id = '29f10000-0000-4000-8000-000000000001' and kind = 'professional_verification_update'),
  2,
  'pedido de correcao avisa o profissional'
);
select is(
  public.professional_verification_is_current('29f10000-0000-4000-8000-000000000001'),
  false,
  'correcao nao concede acesso'
);

-- Profissional corrige e reenvia
select set_config('request.jwt.claims', '{"sub":"29f10000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$select verification_status, submission from public.submit_professional_onboarding()$$,
  $$values ('pending'::text, 2)$$,
  'reenvio da correcao volta para a fila'
);
select ok(
  (select count(*) = 1 from public.list_my_professional_verification_events()
   where reason_code = 'correction_submitted'),
  'trilha registra o reenvio'
);
select lives_ok(
  $$select public.record_professional_precheck(2, 'manual_hold', 'automated_precheck_manual_hold')$$,
  'pre-checagem do envio 2 aceita'
);
reset role;

-- Aprovacao eventual, so humana
select set_config('request.jwt.claims', '{"sub":"29f10000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.review_professional_verification('29f10000-0000-4000-8000-000000000001', 'under_review', 'review_started', 'elyra_workflow')$$,
  'nova revisao'
);
select lives_ok(
  $$select public.review_professional_verification('29f10000-0000-4000-8000-000000000001', 'verified', 'registry_active_confirmed', 'cfp_cadastro_nacional_manual', repeat('b', 64), 365)$$,
  'aprovacao eventual por reviewer humano'
);
reset role;

select is(
  public.professional_verification_is_current('29f10000-0000-4000-8000-000000000001'),
  true,
  'VERIFIED vigente'
);

select set_config('request.jwt.claims', '{"sub":"29f10000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.submit_professional_onboarding()$$,
  '22023', 'already verified',
  'verificado nao reenvia cadastro'
);
reset role;

-- Invariante: nenhuma aprovacao sem reviewer humano, fonte manual e digest
select throws_ok(
  $$insert into public.professional_verifications (professional_user_id, from_status, to_status, reason_code, source, actor_role, evidence_digest, review_due_at)
    values ('29f10000-0000-4000-8000-000000000001', 'pending', 'verified', 'registry_active_confirmed', 'elyra_precheck', 'system', repeat('c', 64), now() + interval '1 day')$$,
  '23514', null,
  'nem o superusuario grava aprovacao automatica na trilha'
);

-- Editar credencial verificada a devolve a declarada
update public.professional_credentials
set trust_state = 'verified', verified_at = now(), evidence_digest = repeat('d', 64),
    verification_source = 'document_manual', policy_version = 'pgtap'
where user_id = '29f10000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims', '{"sub":"29f10000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
update public.professional_credentials set institution = 'Universidade Y' where user_id = auth.uid();
select is(
  (select trust_state from public.professional_credentials where user_id = auth.uid()),
  'declared',
  'editar item verificado o devolve a declarado'
);
reset role;

select * from finish();
rollback;
