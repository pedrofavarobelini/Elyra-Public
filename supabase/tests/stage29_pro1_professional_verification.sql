-- Stage 29 / PRO-1 - verificacao profissional provada por comportamento.
--
-- Cada cenario troca de identidade de verdade (`set local role authenticated`
-- + claims). Superusuario ignora RLS e grants; medir como postgres mediria nada.
--
-- Atores: C (titular), P (profissional), R (reviewer que tambem tem perfil
-- profissional), U (outro profissional), Q (reviewer desativado).

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(57);

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
  ('29100000-0000-4000-8000-000000000001'::uuid, 'pro1-c@elyra.invalid', 'Titular C'),
  ('29100000-0000-4000-8000-000000000002'::uuid, 'pro1-p@elyra.invalid', 'Profissional P'),
  ('29100000-0000-4000-8000-000000000003'::uuid, 'pro1-r@elyra.invalid', 'Reviewer R'),
  ('29100000-0000-4000-8000-000000000004'::uuid, 'pro1-u@elyra.invalid', 'Profissional U'),
  ('29100000-0000-4000-8000-000000000005'::uuid, 'pro1-q@elyra.invalid', 'Reviewer Q')
) as fixture(id, email, name);

insert into public.professional_reviewers (user_id, granted_by)
values ('29100000-0000-4000-8000-000000000003', 'pgtap-fixture');
insert into public.professional_reviewers (user_id, granted_by, active, revoked_at)
values ('29100000-0000-4000-8000-000000000005', 'pgtap-fixture', false, timezone('utc', now()));

insert into public.emotional_checkins (id, user_id, occurred_at, mood_score)
values ('29100000-0000-4000-8000-0000000000e1', '29100000-0000-4000-8000-000000000001',
        timezone('utc', now()), 6);

create function pg_temp.visible_checkins(p_actor uuid)
returns integer
language plpgsql
as $$
declare n integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.emotional_checkins
  where user_id = '29100000-0000-4000-8000-000000000001';
  reset role;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Forma
-- ---------------------------------------------------------------------------

select has_table('public', 'professional_verifications', 'historico de verificacao existe');
select has_table('public', 'professional_reviewers', 'papel de reviewer existe');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.professional_verifications'::regclass), 'historico usa RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.professional_reviewers'::regclass), 'reviewers usa RLS forcada');
select ok(
  not has_table_privilege('anon', 'public.professional_verifications', 'SELECT')
  and not has_table_privilege('authenticated', 'public.professional_verifications', 'SELECT')
  and not has_table_privilege('authenticated', 'public.professional_verifications', 'INSERT')
  and not has_table_privilege('service_role', 'public.professional_verifications', 'UPDATE')
  and not has_table_privilege('service_role', 'public.professional_verifications', 'DELETE'),
  'historico nao tem acesso direto para ninguem, nem service_role'
);
select ok(
  not has_table_privilege('authenticated', 'public.professional_reviewers', 'INSERT')
  and not has_table_privilege('authenticated', 'public.professional_reviewers', 'UPDATE')
  and not has_table_privilege('service_role', 'public.professional_reviewers', 'INSERT'),
  'ninguem se promove a reviewer por Data API'
);
select ok(
  not has_table_privilege('authenticated', 'public.professional_profiles', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.professional_profiles', 'INSERT'),
  'perfil continua sem escrita direta'
);
select ok(
  not has_function_privilege('authenticated', 'public.professional_verification_is_current(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.professional_verification_is_current(uuid)', 'EXECUTE'),
  'nenhum oraculo publico de verificacao'
);
select ok(
  has_function_privilege('service_role', 'public.expire_professional_verifications()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.expire_professional_verifications()', 'EXECUTE'),
  'expiracao materializada e job operacional'
);
select ok(
  not has_function_privilege('anon', 'public.save_professional_credential(text,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.review_professional_verification(uuid,text,text,text,text,integer)', 'EXECUTE'),
  'anon nao cadastra nem revisa'
);
select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'professional_profiles' and column_name = 'verification_status'),
  '''pending''::text',
  'cadastro nasce pending'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'professional_verifications'
      and column_name in ('document', 'cpf', 'note', 'notes', 'payload', 'body')
  ),
  'historico nao tem coluna de documento, CPF ou texto livre'
);

-- ---------------------------------------------------------------------------
-- Cadastro pelo profissional
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"29100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$select public.save_professional_credential('06', '06/123456', 'Psicologia clinica')$$,
  'profissional declara a propria credencial'
);
select is(
  (select verification_status from public.professional_profiles where user_id = auth.uid()),
  'pending',
  'credencial declarada fica pending'
);
select throws_ok(
  $$update public.professional_profiles set verification_status = 'verified' where user_id = auth.uid()$$,
  '42501', null,
  'profissional nao se auto-verifica por update direto'
);
select throws_ok(
  $$select public.review_professional_verification(auth.uid(), 'verified', 'registry_active_confirmed', 'cfp_cadastro_nacional_manual', repeat('a', 64), 365)$$,
  '42501', null,
  'profissional nao chama a RPC de reviewer'
);
select throws_ok(
  $$select public.save_professional_credential('00', '06/123456', 'Psicologia')$$,
  '22023', null,
  'regiao fora do formato e recusada'
);
select is(
  (select count(*)::integer from public.list_my_professional_verification_events()),
  1,
  'profissional le o proprio historico'
);
select ok(
  not exists (
    select 1 from pg_proc p
    where p.proname = 'list_my_professional_verification_events'
      and ('actor_user_id' = any(p.proargnames) or 'evidence_digest' = any(p.proargnames))
  ),
  'historico proprio nao expoe reviewer nem digest'
);

reset role;

select set_config('request.jwt.claims', '{"sub":"29100000-0000-4000-8000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.save_professional_credential('06', '06-123.456', 'Psicologia')$$,
  '23505', null,
  'mesma credencial normalizada nao pertence a duas contas'
);
select is(
  (select count(*)::integer from public.list_my_professional_verification_events()),
  0,
  'U nao ve historico de P'
);
select lives_ok(
  $$select public.save_professional_credential('07', '07/999999', 'Psicologia')$$,
  'U cadastra credencial propria'
);
reset role;

-- R tambem e profissional, para provar a proibicao de auto-revisao.
select set_config('request.jwt.claims', '{"sub":"29100000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.save_professional_credential('08', '08/555555', 'Psicologia')$$,
  'reviewer pode ter perfil profissional proprio'
);
select throws_ok(
  $$select * from public.list_professional_verification_queue()$$,
  '42501', null,
  'reviewer sem aal2 nao abre a fila'
);
reset role;

-- ---------------------------------------------------------------------------
-- Fluxo de revisao
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"29100000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is(
  (select count(*)::integer from public.list_professional_verification_queue()
   where professional_user_id in ('29100000-0000-4000-8000-000000000002', '29100000-0000-4000-8000-000000000004')),
  2,
  'fila mostra os pendentes de terceiros'
);
select is(
  (select count(*)::integer from public.list_professional_verification_queue()
   where professional_user_id = auth.uid()),
  0,
  'fila nunca mostra o proprio reviewer'
);
select throws_ok(
  $$select public.review_professional_verification(auth.uid(), 'under_review', 'review_started', 'elyra_workflow', null, null)$$,
  '42501', null,
  'reviewer nao revisa a si mesmo'
);
select throws_ok(
  $$select public.review_professional_verification('29100000-0000-4000-8000-000000000002', 'verified', 'registry_active_confirmed', 'cfp_cadastro_nacional_manual', repeat('a', 64), 365)$$,
  '22023', null,
  'pending nao pula direto para verified'
);
select lives_ok(
  $$select public.review_professional_verification('29100000-0000-4000-8000-000000000002', 'under_review', 'review_started', 'elyra_workflow', null, null)$$,
  'reviewer abre a revisao'
);
select throws_ok(
  $$select public.review_professional_verification('29100000-0000-4000-8000-000000000002', 'verified', 'registry_active_confirmed', 'cfp_cadastro_nacional_manual', null, 365)$$,
  '22023', null,
  'aprovacao sem digest do fato consultado e recusada'
);
select throws_ok(
  $$select public.review_professional_verification('29100000-0000-4000-8000-000000000002', 'verified', 'registry_active_confirmed', 'elyra_workflow', repeat('a', 64), 365)$$,
  '22023', null,
  'aprovacao sem fonte oficial manual e recusada'
);
select throws_ok(
  $$select public.review_professional_verification('29100000-0000-4000-8000-000000000002', 'verified', 'registry_active_confirmed', 'cfp_cadastro_nacional_manual', repeat('a', 64), 5000)$$,
  '22023', null,
  'validade acima de 365 dias e recusada'
);
select lives_ok(
  $$select public.review_professional_verification('29100000-0000-4000-8000-000000000002', 'pending', 'source_unavailable', 'cfp_cadastro_nacional_manual', null, null)$$,
  'fonte indisponivel devolve para pending'
);
reset role;

select is(
  (select verification_status from public.professional_profiles where user_id = '29100000-0000-4000-8000-000000000002'),
  'pending',
  'falha de fonte externa nunca vira aprovacao'
);

-- Conexao aceita + grant vigente, antes da verificacao: G-01.
insert into public.professional_connections (
  id, client_user_id, professional_user_id, invited_by_user_id, status, accepted_at
) values (
  '29100000-0000-4000-8000-0000000000c1', '29100000-0000-4000-8000-000000000001',
  '29100000-0000-4000-8000-000000000002', '29100000-0000-4000-8000-000000000001',
  'active', timezone('utc', now()) -- Stage 29 / PRO-3: 'accepted' agora e 'active'
);
insert into public.sharing_permissions (connection_id, scope)
values ('29100000-0000-4000-8000-0000000000c1', 'emotional');

select is(pg_temp.visible_checkins('29100000-0000-4000-8000-000000000002'), 0,
  'G-01 fechado: nao verificado com conexao e grant nao le');

select set_config('request.jwt.claims', '{"sub":"29100000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.review_professional_verification('29100000-0000-4000-8000-000000000002', 'under_review', 'review_started', 'elyra_workflow', null, null)$$,
  'revisao reaberta'
);
select lives_ok(
  $$select public.review_professional_verification('29100000-0000-4000-8000-000000000002', 'verified', 'registry_active_confirmed', 'cfp_cadastro_nacional_manual', encode(extensions.digest('consulta-fixture', 'sha256'), 'hex'), 365)$$,
  'aprovacao com fonte, motivo e digest'
);
reset role;

select is(pg_temp.visible_checkins('29100000-0000-4000-8000-000000000002'), 1,
  'verificado + conexao + grant le o recurso autorizado');
select ok(
  (select verification_review_due_at > timezone('utc', now()) + interval '364 days'
   from public.professional_profiles where user_id = '29100000-0000-4000-8000-000000000002'),
  'validade gravada'
);
select is(
  (select count(*)::integer from public.professional_verifications
   where professional_user_id = '29100000-0000-4000-8000-000000000002'
     and to_status = 'verified' and actor_role = 'reviewer'
     and actor_user_id = '29100000-0000-4000-8000-000000000003'),
  1,
  'aprovacao registra ator, fonte e instante'
);
select ok(
  exists (select 1 from public.audit_logs
          where action = 'professional_verification.verified'
            and entity_id = '29100000-0000-4000-8000-000000000002'),
  'aprovacao entra no audit do ator'
);

-- Reviewer desativado.
select set_config('request.jwt.claims', '{"sub":"29100000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.review_professional_verification('29100000-0000-4000-8000-000000000004', 'under_review', 'review_started', 'elyra_workflow', null, null)$$,
  '42501', null,
  'reviewer desativado nao decide'
);
reset role;

-- Validade vencida: nega na leitura, sem esperar job.
update public.professional_profiles
set verification_reviewed_at = timezone('utc', now()) - interval '400 days',
    verification_review_due_at = timezone('utc', now()) - interval '1 minute'
where user_id = '29100000-0000-4000-8000-000000000002';

select is(pg_temp.visible_checkins('29100000-0000-4000-8000-000000000002'), 0,
  'verificacao vencida nega acesso imediatamente');
select is(
  public.professional_effective_verification_status('verified', timezone('utc', now()) - interval '1 minute'),
  'expired_review',
  'estado efetivo de verified vencido e expired_review'
);
select is(public.expire_professional_verifications(), 1, 'job materializa a expiracao');
select is(
  (select verification_status from public.professional_profiles where user_id = '29100000-0000-4000-8000-000000000002'),
  'expired_review',
  'expiracao gravada com evento de sistema'
);

-- Revalida e suspende.
select set_config('request.jwt.claims', '{"sub":"29100000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.review_professional_verification('29100000-0000-4000-8000-000000000002', 'under_review', 'review_started', 'elyra_workflow', null, null)$$,
  'expirado volta para revisao'
);
select lives_ok(
  $$select public.review_professional_verification('29100000-0000-4000-8000-000000000002', 'verified', 'registry_active_confirmed', 'crp_regional_manual', repeat('b', 64), 180)$$,
  'revalidado pela fonte regional'
);
select lives_ok(
  $$select public.review_professional_verification('29100000-0000-4000-8000-000000000002', 'suspended', 'conduct_report', 'elyra_workflow', null, null)$$,
  'reviewer suspende'
);
reset role;

select is(pg_temp.visible_checkins('29100000-0000-4000-8000-000000000002'), 0,
  'suspenso nao le');

select set_config('request.jwt.claims', '{"sub":"29100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.save_professional_credential('09', '09/000001', 'Psicologia')$$,
  '42501', null,
  'trocar credencial nao tira da suspensao'
);
select lives_ok(
  $$select public.save_professional_credential('06', '06/123456', 'Psicologia social')$$,
  'especialidade declarada continua editavel'
);
select is(
  (select verification_status from public.professional_profiles where user_id = auth.uid()),
  'suspended',
  'editar campo declarado nao altera a verificacao'
);
reset role;

-- Troca de credencial de um verificado derruba a verificacao.
select set_config('request.jwt.claims', '{"sub":"29100000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.review_professional_verification('29100000-0000-4000-8000-000000000004', 'under_review', 'review_started', 'elyra_workflow', null, null)$$,
  'U em revisao'
);
select lives_ok(
  $$select public.review_professional_verification('29100000-0000-4000-8000-000000000004', 'verified', 'registry_active_confirmed', 'cfp_cadastro_nacional_manual', repeat('c', 64), 365)$$,
  'U verificado'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"29100000-0000-4000-8000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.save_professional_credential('07', '07/999998', 'Psicologia')$$,
  'U troca o numero do registro'
);
select is(
  (select verification_status || ':' || coalesce(verification_review_due_at::text, 'null')
   from public.professional_profiles where user_id = auth.uid()),
  'pending:null',
  'credencial trocada volta a pending e perde a validade'
);
reset role;

select * from finish();
rollback;
