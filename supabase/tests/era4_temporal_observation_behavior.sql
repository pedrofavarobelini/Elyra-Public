-- Era 4 / 22B - detalhe temporal, provado por comportamento.
--
-- O que este arquivo prova, e que nenhum teste de forma provaria:
--   1. segmento de transcricao segue o escopo da **transcricao**, e nunca o do
--      resultado - senao `multimodal_result` vazaria conteudo;
--   2. janela segue o escopo do resultado;
--   3. os dois nascem com retencao de 7 dias;
--   4. sem o consentimento correspondente o detalhe **nao nasce**.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '92000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'era4b-cliente@elyra.invalid', null,
   timezone('utc', now()), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Cliente Era4B"}'::jsonb,
   timezone('utc', now()), timezone('utc', now())),
  ('00000000-0000-0000-0000-000000000000', '92000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'era4b-profissional@elyra.invalid', null,
   timezone('utc', now()), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Profissional Era4B"}'::jsonb,
   timezone('utc', now()), timezone('utc', now()));

insert into public.professional_profiles (user_id, registration_number, specialty)
values ('92000000-0000-4000-8000-000000000002', 'CRP-ERA4B-01', 'Psicologia');

-- Stage 29 / PRO-1: o acesso profissional passou a exigir verificacao
-- vigente (G-01). A fixture representa um profissional ja revisado; o
-- portao em si e provado em `stage29_pro1_professional_verification.sql`.
update public.professional_profiles
set council_region = '06',
    verification_status = 'verified',
    verification_reviewed_at = timezone('utc', now()),
    verification_review_due_at = timezone('utc', now()) + interval '365 days'
where user_id in ('92000000-0000-4000-8000-000000000002');

insert into public.professional_connections (
  id, client_user_id, professional_user_id, invited_by_user_id, status, accepted_at
)
values (
  '92000000-0000-4000-8000-0000000000c1',
  '92000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000002',
  '92000000-0000-4000-8000-000000000001',
  'active', timezone('utc', now()) -- Stage 29 / PRO-3: 'accepted' agora e 'active'
);

-- Sessao com resultado E transcricao consentidos, para que o teste possa medir
-- os dois escopos separadamente em vez de presumir que andam juntos.
insert into public.multimodal_sessions (
  id, user_id, kind, status, microphone_consent, camera_consent,
  transcription_consent, ai_analysis_consent,
  share_result_consent, share_transcript_consent
)
values (
  '92000000-0000-4000-8000-0000000000a1',
  '92000000-0000-4000-8000-000000000001',
  'guided', 'completed', true, true, true, true, true, true
);

insert into public.session_signal_windows
  (session_id, user_id, signal_name, start_offset_ms, end_offset_ms, value)
values
  ('92000000-0000-4000-8000-0000000000a1', '92000000-0000-4000-8000-000000000001',
   'pause_count', 0, 60000, 3),
  ('92000000-0000-4000-8000-0000000000a1', '92000000-0000-4000-8000-000000000001',
   'pause_count', 60000, 120000, 9);

insert into public.session_transcript_segments
  (session_id, user_id, segment_index, content, start_offset_ms, recognized_at_offset_ms)
values
  ('92000000-0000-4000-8000-0000000000a1', '92000000-0000-4000-8000-000000000001',
   0, 'Falei sobre a semana.', 0, 12000),
  ('92000000-0000-4000-8000-0000000000a1', '92000000-0000-4000-8000-000000000001',
   1, 'Depois mudei de assunto.', 12000, 41000);

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.session_signal_windows
      (session_id, user_id, signal_name, start_offset_ms, end_offset_ms, value)
    values ('92000000-0000-4000-8000-0000000000a1',
            '92000000-0000-4000-8000-000000000001',
            'pause_count', 120000, 120000, 1)$$,
  '23514', null,
  'janela sem duracao positiva e recusada'
);

-- `speech_rate` depende da contagem de palavras, e a Web Speech API nao entrega
-- palavra por instante. O banco recusa a serie que inventaria essa precisao.
select throws_ok(
  $$insert into public.session_signal_windows
      (session_id, user_id, signal_name, start_offset_ms, end_offset_ms, value)
    values ('92000000-0000-4000-8000-0000000000a1',
            '92000000-0000-4000-8000-000000000001',
            'speech_rate', 0, 60000, 130)$$,
  '23514', null,
  'speech_rate nao pode ter janela'
);

select throws_ok(
  $$insert into public.session_transcript_segments
      (session_id, user_id, segment_index, content, start_offset_ms, recognized_at_offset_ms)
    values ('92000000-0000-4000-8000-0000000000a1',
            '92000000-0000-4000-8000-000000000001',
            9, 'trecho', 50000, 10000)$$,
  '23514', null,
  'segmento reconhecido antes de comecar e recusado'
);

-- A sessao e solo enquanto nao houver segundo participante: `user` e a unica
-- afirmacao honesta, e o banco recusa inventar diarization.
select throws_ok(
  $$insert into public.session_transcript_segments
      (session_id, user_id, segment_index, content, start_offset_ms,
       recognized_at_offset_ms, speaker)
    values ('92000000-0000-4000-8000-0000000000a1',
            '92000000-0000-4000-8000-000000000001',
            8, 'trecho', 0, 1000, 'professional')$$,
  '23514', null,
  'nao existe falante alem do titular'
);

-- ---------------------------------------------------------------------------
-- Retencao
-- ---------------------------------------------------------------------------

select ok(
  (select bool_and(retention_until > timezone('utc', now()) + interval '6 days'
                   and retention_until < timezone('utc', now()) + interval '8 days')
   from public.session_signal_windows
   where session_id = '92000000-0000-4000-8000-0000000000a1'),
  'janela nasce com retencao de 7 dias'
);

select ok(
  (select bool_and(retention_until > timezone('utc', now()) + interval '6 days'
                   and retention_until < timezone('utc', now()) + interval '8 days')
   from public.session_transcript_segments
   where session_id = '92000000-0000-4000-8000-0000000000a1'),
  'segmento nasce com retencao de 7 dias'
);

-- ---------------------------------------------------------------------------
-- Visibilidade real
-- ---------------------------------------------------------------------------

create function pg_temp.visivel(p_ator uuid, p_dono uuid, p_tabela text)
returns integer language plpgsql as $$
declare n integer;
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_ator, 'role', 'authenticated')::text, true);
  -- Sem isto o teste mede um superusuario, que ignora RLS - ou seja, mede nada.
  set local role authenticated;
  if p_tabela = 'windows' then
    select count(*) into n from public.session_signal_windows where user_id = p_dono;
  elsif p_tabela = 'segments' then
    select count(*) into n from public.session_transcript_segments where user_id = p_dono;
  else
    raise exception 'tabela nao mapeada: %', p_tabela;
  end if;
  reset role;
  return n;
end;
$$;

select is(
  pg_temp.visivel('92000000-0000-4000-8000-000000000001',
                  '92000000-0000-4000-8000-000000000001', 'windows'),
  2, 'o titular ve as proprias janelas'
);

select is(
  pg_temp.visivel('92000000-0000-4000-8000-000000000002',
                  '92000000-0000-4000-8000-000000000001', 'windows'),
  0, 'profissional sem escopo nao ve janela'
);

select is(
  pg_temp.visivel('92000000-0000-4000-8000-000000000002',
                  '92000000-0000-4000-8000-000000000001', 'segments'),
  0, 'profissional sem escopo nao ve segmento'
);

-- Escopo de RESULTADO: abre janela, e **nao** abre segmento.
insert into public.sharing_permissions (id, connection_id, scope, status)
values (
  '92000000-0000-4000-8000-0000000000f1',
  '92000000-0000-4000-8000-0000000000c1',
  'multimodal_result', 'granted'
);

select is(
  pg_temp.visivel('92000000-0000-4000-8000-000000000002',
                  '92000000-0000-4000-8000-000000000001', 'windows'),
  2, 'escopo de resultado abre a janela'
);

-- **A assercao central de privacidade desta sub-stage.** Se o escopo de
-- resultado abrisse o segmento, o relatorio profissional passaria a vazar
-- conteudo de transcricao sob autorizacao de resultado.
select is(
  pg_temp.visivel('92000000-0000-4000-8000-000000000002',
                  '92000000-0000-4000-8000-000000000001', 'segments'),
  0, 'escopo de resultado NAO abre o segmento de transcricao'
);

insert into public.sharing_permissions (id, connection_id, scope, status)
values (
  '92000000-0000-4000-8000-0000000000f2',
  '92000000-0000-4000-8000-0000000000c1',
  'multimodal_transcript', 'granted'
);

select is(
  pg_temp.visivel('92000000-0000-4000-8000-000000000002',
                  '92000000-0000-4000-8000-000000000001', 'segments'),
  2, 'so o escopo de transcricao abre o segmento'
);

select * from finish();
rollback;
