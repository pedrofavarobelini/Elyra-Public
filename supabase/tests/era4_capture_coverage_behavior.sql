-- Era 4 / 22A - cobertura de captura, provada por comportamento.
--
-- Segue o padrao que a Era 3 estabeleceu: o teste troca de identidade de verdade
-- (`set local role authenticated` dentro de um helper `plpgsql`), porque um
-- superusuario **ignora RLS** e medir visibilidade sem trocar de papel mediria o
-- nada.
--
-- O que este arquivo prova, e que nenhum teste de forma provaria:
--   1. as constraints recusam a captura parcial mal formada;
--   2. o titular ve a propria cobertura;
--   3. o profissional so ve com escopo **e** consentimento de resultado;
--   4. sem consentimento da sessao, a cobertura some mesmo com escopo concedido.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(14);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'era4-cliente@elyra.invalid', null,
   timezone('utc', now()), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Cliente Era4"}'::jsonb,
   timezone('utc', now()), timezone('utc', now())),
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'era4-profissional@elyra.invalid', null,
   timezone('utc', now()), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Profissional Era4"}'::jsonb,
   timezone('utc', now()), timezone('utc', now()));

insert into public.professional_profiles (user_id, registration_number, specialty)
values ('91000000-0000-4000-8000-000000000002', 'CRP-ERA4-01', 'Psicologia');

-- Stage 29 / PRO-1: o acesso profissional passou a exigir verificacao
-- vigente (G-01). A fixture representa um profissional ja revisado; o
-- portao em si e provado em `stage29_pro1_professional_verification.sql`.
update public.professional_profiles
set council_region = '06',
    verification_status = 'verified',
    verification_reviewed_at = timezone('utc', now()),
    verification_review_due_at = timezone('utc', now()) + interval '365 days'
where user_id in ('91000000-0000-4000-8000-000000000002');

insert into public.professional_connections (
  id, client_user_id, professional_user_id, invited_by_user_id, status, accepted_at
)
values (
  '91000000-0000-4000-8000-0000000000c1',
  '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000001',
  'active', -- Stage 29 / PRO-3: 'accepted' passou a se chamar 'active'
  timezone('utc', now())
);

-- **Duas** sessoes, e nao uma alterada no meio: o contrato de consentimento de
-- sessao e imutavel por trigger, e com razao - consentimento que muda depois do
-- fato nao e consentimento. Entao a diferenca e medida entre duas sessoes reais.
insert into public.multimodal_sessions (
  id, user_id, kind, status, camera_consent, microphone_consent,
  share_result_consent
)
values
  ('91000000-0000-4000-8000-0000000000a1',
   '91000000-0000-4000-8000-000000000001',
   'guided', 'completed', true, true, false),
  ('91000000-0000-4000-8000-0000000000a2',
   '91000000-0000-4000-8000-000000000001',
   'guided', 'completed', true, true, true);

-- ---------------------------------------------------------------------------
-- 1. As constraints recusam captura parcial mal formada
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.session_modality_coverage
      (session_id, user_id, modality, outcome, reason, coverage_ms, session_duration_ms)
    values ('91000000-0000-4000-8000-0000000000a1',
            '91000000-0000-4000-8000-000000000001',
            'camera', 'full', 'interrupted', 300000, 300000)$$,
  '23514',
  null,
  'cobertura completa nao pode carregar motivo'
);

select throws_ok(
  $$insert into public.session_modality_coverage
      (session_id, user_id, modality, outcome, reason, coverage_ms, session_duration_ms)
    values ('91000000-0000-4000-8000-0000000000a1',
            '91000000-0000-4000-8000-000000000001',
            'camera', 'partial', null, 100000, 300000)$$,
  '23514',
  null,
  'cobertura parcial exige motivo declarado'
);

-- Perder a track e negar permissao sao coisas diferentes, e o banco recusa
-- confundir uma com a outra.
select throws_ok(
  $$insert into public.session_modality_coverage
      (session_id, user_id, modality, outcome, reason, coverage_ms, session_duration_ms)
    values ('91000000-0000-4000-8000-0000000000a1',
            '91000000-0000-4000-8000-000000000001',
            'camera', 'partial', 'denied', 100000, 300000)$$,
  '23514',
  null,
  'motivo de ausencia nao vale para cobertura parcial'
);

-- Ausencia com tempo afirmaria captura, que e o que `absent` nega.
select throws_ok(
  $$insert into public.session_modality_coverage
      (session_id, user_id, modality, outcome, reason, coverage_ms, session_duration_ms)
    values ('91000000-0000-4000-8000-0000000000a1',
            '91000000-0000-4000-8000-000000000001',
            'screen', 'absent', 'unsupported', 1, 300000)$$,
  '23514',
  null,
  'modalidade ausente nao pode ter cobertura'
);

select throws_ok(
  $$insert into public.session_modality_coverage
      (session_id, user_id, modality, outcome, reason, coverage_ms, session_duration_ms)
    values ('91000000-0000-4000-8000-0000000000a1',
            '91000000-0000-4000-8000-000000000001',
            'camera', 'partial', 'interrupted', 400000, 300000)$$,
  '23514',
  null,
  'cobertura nao pode exceder a duracao da sessao'
);

select throws_ok(
  $$insert into public.session_modality_coverage
      (session_id, user_id, modality, outcome, reason, coverage_ms, session_duration_ms)
    values ('91000000-0000-4000-8000-0000000000a1',
            '91000000-0000-4000-8000-000000000001',
            'camera', 'ansiedade', null, 0, 300000)$$,
  '23514',
  null,
  'desfecho fora do vocabulario fechado e recusado'
);

-- ---------------------------------------------------------------------------
-- 2. Linhas legitimas: uma parcial, uma ausente
-- ---------------------------------------------------------------------------

insert into public.session_modality_coverage
  (session_id, user_id, modality, outcome, reason, coverage_ms, session_duration_ms)
values
  ('91000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-000000000001',
   'microphone', 'full', null, 300000, 300000),
  ('91000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-000000000001',
   'camera', 'partial', 'interrupted', 40000, 300000),
  ('91000000-0000-4000-8000-0000000000a1', '91000000-0000-4000-8000-000000000001',
   'screen', 'absent', 'unsupported', 0, 300000);

select is(
  (select count(*)::integer from public.session_modality_coverage
   where session_id = '91000000-0000-4000-8000-0000000000a1'),
  3,
  'as tres modalidades sao registradas, inclusive a ausente'
);

-- ---------------------------------------------------------------------------
-- 3. Helper de visibilidade real
-- ---------------------------------------------------------------------------

create function pg_temp.cobertura_visivel(p_ator uuid, p_dono uuid)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_ator, 'role', 'authenticated')::text,
    true
  );
  -- Sem isto o teste mede um superusuario, que ignora RLS - ou seja, mede nada.
  set local role authenticated;
  select count(*) into n from public.session_modality_coverage
  where user_id = p_dono;
  reset role;
  return n;
end;
$$;

select is(
  pg_temp.cobertura_visivel(
    '91000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001'
  ),
  3,
  'o titular ve a propria cobertura'
);

select is(
  pg_temp.cobertura_visivel(
    '91000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000001'
  ),
  0,
  'profissional sem escopo nao ve cobertura nenhuma'
);

-- ---------------------------------------------------------------------------
-- 4. Escopo concedido, mas sessao sem consentimento de resultado
--
-- Os dois portoes sao independentes de proposito: o escopo e da conexao, o
-- consentimento e da sessao. Um sozinho nao abre nada.
-- ---------------------------------------------------------------------------

insert into public.sharing_permissions (id, connection_id, scope, status)
values (
  '91000000-0000-4000-8000-0000000000f1',
  '91000000-0000-4000-8000-0000000000c1',
  'multimodal_result',
  'granted'
);

select is(
  pg_temp.cobertura_visivel(
    '91000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000001'
  ),
  0,
  'escopo sem consentimento da sessao nao revela cobertura'
);

-- ---------------------------------------------------------------------------
-- 5. Escopo + consentimento
-- ---------------------------------------------------------------------------

-- A sessao **com** consentimento recebe a propria cobertura.
insert into public.session_modality_coverage
  (session_id, user_id, modality, outcome, reason, coverage_ms, session_duration_ms)
values
  ('91000000-0000-4000-8000-0000000000a2', '91000000-0000-4000-8000-000000000001',
   'microphone', 'full', null, 300000, 300000);

select is(
  pg_temp.cobertura_visivel(
    '91000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000001'
  ),
  1,
  'com escopo e consentimento o profissional ve a cobertura consentida - e so ela'
);

-- ---------------------------------------------------------------------------
-- 6. Revogacao tira a cobertura junto
-- ---------------------------------------------------------------------------

update public.sharing_permissions
set status = 'revoked', revoked_at = timezone('utc', now())
where id = '91000000-0000-4000-8000-0000000000f1';

select is(
  pg_temp.cobertura_visivel(
    '91000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000001'
  ),
  0,
  'permissao revogada deixa de revelar cobertura'
);

-- ---------------------------------------------------------------------------
-- 7. Expiracao tambem
-- ---------------------------------------------------------------------------

update public.sharing_permissions
set status = 'granted', revoked_at = null,
    expires_at = timezone('utc', now()) - interval '1 hour'
where id = '91000000-0000-4000-8000-0000000000f1';

select is(
  pg_temp.cobertura_visivel(
    '91000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000001'
  ),
  0,
  'permissao expirada deixa de revelar cobertura'
);

-- ---------------------------------------------------------------------------
-- 8. RLS forcada, para que nem o dono da tabela escape
-- ---------------------------------------------------------------------------

select is(
  (select relforcerowsecurity from pg_class
   where oid = 'public.session_modality_coverage'::regclass),
  true,
  'session_modality_coverage tem RLS forcada'
);

select * from finish();
rollback;
