-- Era 4 / 22D - o escopo da IA e a janela do multimodal, provados por
-- comportamento.
--
-- Duas afirmacoes que nenhum teste de forma faria:
--
--   1. conceder `multimodal_result` **nao** revela mais a interpretacao de IA.
--      Ate a Era 4 os dois compartilhavam o mesmo portao, e a fronteira
--      DETERMINISTIC / AI - que o produto separa visualmente em toda tela - nao
--      era autorizavel separadamente;
--
--   2. a janela de dados da Era 3 finalmente alcanca o multimodal. Conceder o
--      escopo com `data_from`/`data_to` declarados deixa de entregar o historico
--      multimodal inteiro.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(10);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'era4d-cliente@elyra.invalid', null,
   timezone('utc', now()), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Cliente Era4D"}'::jsonb,
   timezone('utc', now()), timezone('utc', now())),
  ('00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'era4d-profissional@elyra.invalid', null,
   timezone('utc', now()), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Profissional Era4D"}'::jsonb,
   timezone('utc', now()), timezone('utc', now()));

insert into public.professional_profiles (user_id, registration_number, specialty)
values ('93000000-0000-4000-8000-000000000002', 'CRP-ERA4D-01', 'Psicologia');

-- Stage 29 / PRO-1: o acesso profissional passou a exigir verificacao
-- vigente (G-01). A fixture representa um profissional ja revisado; o
-- portao em si e provado em `stage29_pro1_professional_verification.sql`.
update public.professional_profiles
set council_region = '06',
    verification_status = 'verified',
    verification_reviewed_at = timezone('utc', now()),
    verification_review_due_at = timezone('utc', now()) + interval '365 days'
where user_id in ('93000000-0000-4000-8000-000000000002');

insert into public.professional_connections (
  id, client_user_id, professional_user_id, invited_by_user_id, status, accepted_at
)
values (
  '93000000-0000-4000-8000-0000000000c1',
  '93000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000002',
  '93000000-0000-4000-8000-000000000001',
  'active', timezone('utc', now()) -- Stage 29 / PRO-3: 'accepted' agora e 'active'
);

-- Duas sessoes em datas diferentes, para que a janela tenha o que recortar.
insert into public.multimodal_sessions (
  id, user_id, kind, status, microphone_consent, ai_analysis_consent,
  share_result_consent, started_at
)
values
  ('93000000-0000-4000-8000-0000000000a1',
   '93000000-0000-4000-8000-000000000001',
   'guided', 'completed', true, true, true,
   timezone('utc', now()) - interval '40 days'),
  ('93000000-0000-4000-8000-0000000000a2',
   '93000000-0000-4000-8000-000000000001',
   'guided', 'completed', true, true, true,
   timezone('utc', now()) - interval '2 days');

insert into public.derived_features
  (session_id, user_id, signal_name, unit, value, status,
   personal_baseline_mean, personal_baseline_samples, delta_vs_personal_baseline)
values
  ('93000000-0000-4000-8000-0000000000a1', '93000000-0000-4000-8000-000000000001',
   'pause_count', 'count', 5, 'available', 4, 3, 1),
  ('93000000-0000-4000-8000-0000000000a2', '93000000-0000-4000-8000-000000000001',
   'pause_count', 'count', 7, 'available', 4, 3, 3);

insert into public.session_interpretations
  (session_id, user_id, correlation_id, request_fingerprint, provider_used,
   model, confidence, payload)
values
  ('93000000-0000-4000-8000-0000000000a1', '93000000-0000-4000-8000-000000000001',
   'era4d-corr-antiga', repeat('a', 64), 'mock', 'mock-v1', 'moderate', '{}'::jsonb),
  ('93000000-0000-4000-8000-0000000000a2', '93000000-0000-4000-8000-000000000001',
   'era4d-corr-recente', repeat('b', 64), 'mock', 'mock-v1', 'moderate', '{}'::jsonb);

create function pg_temp.visivel(p_ator uuid, p_dono uuid, p_tabela text)
returns integer language plpgsql as $$
declare n integer;
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_ator, 'role', 'authenticated')::text, true);
  -- Sem isto o teste mede um superusuario, que ignora RLS - ou seja, mede nada.
  set local role authenticated;
  if p_tabela = 'features' then
    select count(*) into n from public.derived_features where user_id = p_dono;
  elsif p_tabela = 'interpretations' then
    select count(*) into n from public.session_interpretations where user_id = p_dono;
  elsif p_tabela = 'sessions' then
    select count(*) into n from public.multimodal_sessions where user_id = p_dono;
  else
    raise exception 'tabela nao mapeada: %', p_tabela;
  end if;
  reset role;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Estado inicial: nada concedido
-- ---------------------------------------------------------------------------

select is(
  pg_temp.visivel('93000000-0000-4000-8000-000000000002',
                  '93000000-0000-4000-8000-000000000001', 'features'),
  0, 'sem escopo, nenhum sinal e visivel'
);

select is(
  pg_temp.visivel('93000000-0000-4000-8000-000000000002',
                  '93000000-0000-4000-8000-000000000001', 'interpretations'),
  0, 'sem escopo, nenhuma interpretacao e visivel'
);

-- ---------------------------------------------------------------------------
-- `multimodal_result` sem janela: abre o calculo, e SO o calculo
-- ---------------------------------------------------------------------------

insert into public.sharing_permissions (id, connection_id, scope, status)
values (
  '93000000-0000-4000-8000-0000000000f1',
  '93000000-0000-4000-8000-0000000000c1',
  'multimodal_result', 'granted'
);

select is(
  pg_temp.visivel('93000000-0000-4000-8000-000000000002',
                  '93000000-0000-4000-8000-000000000001', 'features'),
  2, 'escopo de resultado abre os sinais das duas sessoes'
);

-- **A assercao central desta sub-stage.** Se isto devolvesse 2, conceder o
-- calculo continuaria concedendo a leitura de modelo junto.
select is(
  pg_temp.visivel('93000000-0000-4000-8000-000000000002',
                  '93000000-0000-4000-8000-000000000001', 'interpretations'),
  0, 'escopo de resultado NAO abre a interpretacao de IA'
);

-- ---------------------------------------------------------------------------
-- Escopo proprio da IA
-- ---------------------------------------------------------------------------

insert into public.sharing_permissions (id, connection_id, scope, status)
values (
  '93000000-0000-4000-8000-0000000000f2',
  '93000000-0000-4000-8000-0000000000c1',
  'multimodal_ai_interpretation', 'granted'
);

select is(
  pg_temp.visivel('93000000-0000-4000-8000-000000000002',
                  '93000000-0000-4000-8000-000000000001', 'interpretations'),
  2, 'so o escopo proprio abre a interpretacao de IA'
);

-- ---------------------------------------------------------------------------
-- A janela da Era 3 alcanca o multimodal
--
-- Recorte para os ultimos 7 dias: a sessao de 40 dias atras sai, a de 2 fica.
-- ---------------------------------------------------------------------------

update public.sharing_permissions
set data_from = (timezone('utc', now()) - interval '7 days')::date
where id in (
  '93000000-0000-4000-8000-0000000000f1',
  '93000000-0000-4000-8000-0000000000f2'
);

select is(
  pg_temp.visivel('93000000-0000-4000-8000-000000000002',
                  '93000000-0000-4000-8000-000000000001', 'features'),
  1, 'a janela recorta os sinais: so a sessao dentro do periodo aparece'
);

select is(
  pg_temp.visivel('93000000-0000-4000-8000-000000000002',
                  '93000000-0000-4000-8000-000000000001', 'interpretations'),
  1, 'a janela recorta a interpretacao junto'
);

select is(
  pg_temp.visivel('93000000-0000-4000-8000-000000000002',
                  '93000000-0000-4000-8000-000000000001', 'sessions'),
  1, 'a janela recorta a propria sessao'
);

-- ---------------------------------------------------------------------------
-- Revogacao e expiracao continuam valendo com o escopo novo
-- ---------------------------------------------------------------------------

update public.sharing_permissions
set status = 'revoked', revoked_at = timezone('utc', now())
where id = '93000000-0000-4000-8000-0000000000f2';

select is(
  pg_temp.visivel('93000000-0000-4000-8000-000000000002',
                  '93000000-0000-4000-8000-000000000001', 'interpretations'),
  0, 'revogar o escopo de IA fecha a interpretacao'
);

update public.sharing_permissions
set status = 'granted', revoked_at = null,
    expires_at = timezone('utc', now()) - interval '1 hour'
where id = '93000000-0000-4000-8000-0000000000f2';

select is(
  pg_temp.visivel('93000000-0000-4000-8000-000000000002',
                  '93000000-0000-4000-8000-000000000001', 'interpretations'),
  0, 'escopo de IA expirado fecha a interpretacao'
);

select * from finish();
rollback;
