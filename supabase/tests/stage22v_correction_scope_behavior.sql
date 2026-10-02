-- Stage 22-V - a correcao de transcricao pertence ao dominio da TRANSCRICAO,
-- provado por COMPORTAMENTO.
--
-- O teste anterior verificava apenas que "existe uma policy profissional".
-- Isso nao prova nada sobre qual scope ela exige - e foi exatamente por isso
-- que a policy publicada pode nascer exigindo `multimodal_result` sem nenhum
-- teste vermelho.
--
-- Aqui o profissional e real: conexao aceita, permissoes reais, `set role
-- authenticated` com o `sub` dele. Sem trocar de role o teste mede um
-- superusuario, que ignora RLS - ou seja, mede nada.
--
-- Duas sessoes, porque o contrato da sessao e imutavel depois de criada: uma
-- que compartilha so o resultado, outra que compartilha tambem a transcricao.
-- Virar a chave num update seria mais curto e o banco recusa - com razao.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(15);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '96000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 's22v-cliente@elyra.invalid', null,
   timezone('utc', now()), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Cliente 22V"}'::jsonb,
   timezone('utc', now()), timezone('utc', now())),
  ('00000000-0000-0000-0000-000000000000', '96000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 's22v-profissional@elyra.invalid', null,
   timezone('utc', now()), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Profissional 22V"}'::jsonb,
   timezone('utc', now()), timezone('utc', now()));

insert into public.professional_profiles (user_id, registration_number, specialty)
values ('96000000-0000-4000-8000-000000000002', 'CRP-22V-01', 'Psicologia');

-- Stage 29 / PRO-1: o acesso profissional passou a exigir verificacao
-- vigente (G-01). A fixture representa um profissional ja revisado; o
-- portao em si e provado em `stage29_pro1_professional_verification.sql`.
update public.professional_profiles
set council_region = '06',
    verification_status = 'verified',
    verification_reviewed_at = timezone('utc', now()),
    verification_review_due_at = timezone('utc', now()) + interval '365 days'
where user_id in ('96000000-0000-4000-8000-000000000002');

insert into public.professional_connections (
  id, client_user_id, professional_user_id, invited_by_user_id, status, accepted_at
)
values (
  '96000000-0000-4000-8000-0000000000c1',
  '96000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000002',
  '96000000-0000-4000-8000-000000000001',
  'active', timezone('utc', now()) -- Stage 29 / PRO-3: 'accepted' agora e 'active'
);

-- `a1` compartilha SOMENTE o resultado. `a2` compartilha tambem a transcricao.
insert into public.multimodal_sessions (
  id, user_id, kind, status, microphone_consent, transcription_consent,
  ai_analysis_consent, share_result_consent, share_transcript_consent, started_at
)
values
  ('96000000-0000-4000-8000-0000000000a1',
   '96000000-0000-4000-8000-000000000001',
   'guided', 'completed', true, true, true, true, false,
   timezone('utc', now()) - interval '2 days'),
  ('96000000-0000-4000-8000-0000000000a2',
   '96000000-0000-4000-8000-000000000001',
   'guided', 'completed', true, true, true, true, true,
   timezone('utc', now()) - interval '2 days');

insert into public.session_transcripts
  (id, session_id, user_id, status, source, content, word_count, voiced_duration_ms,
   asr_model, asr_quantization, asr_runtime, asr_runtime_version, asr_vad)
values
  ('96000000-0000-4000-8000-0000000000d1',
   '96000000-0000-4000-8000-0000000000a1',
   '96000000-0000-4000-8000-000000000001', 'available', 'local_whisper',
   'eu nao consegui terminar', 4, 5000,
   'onnx-community/whisper-base', 'q8', 'transformers.js', '3.7.6', 'silero_vad_v5'),
  ('96000000-0000-4000-8000-0000000000d2',
   '96000000-0000-4000-8000-0000000000a2',
   '96000000-0000-4000-8000-000000000001', 'available', 'local_whisper',
   'eu nao consegui terminar', 4, 5000,
   'onnx-community/whisper-base', 'q8', 'transformers.js', '3.7.6', 'silero_vad_v5');

insert into public.transcript_corrections
  (session_id, user_id, transcript_id, original_content, corrected_content,
   original_source, revision)
values
  ('96000000-0000-4000-8000-0000000000a1',
   '96000000-0000-4000-8000-000000000001',
   '96000000-0000-4000-8000-0000000000d1',
   'eu nao consegui terminar', 'eu nao consegui terminar hoje',
   'local_whisper', 1),
  ('96000000-0000-4000-8000-0000000000a2',
   '96000000-0000-4000-8000-000000000001',
   '96000000-0000-4000-8000-0000000000d2',
   'eu nao consegui terminar', 'eu nao consegui terminar ontem',
   'local_whisper', 1);

insert into public.session_feedback
  (session_id, user_id, target_type, target_id, rating)
values (
  '96000000-0000-4000-8000-0000000000a2',
  '96000000-0000-4000-8000-000000000001',
  'transcription', '96000000-0000-4000-8000-0000000000d2', 'negative'
);

create function pg_temp.visivel(
  p_ator uuid, p_sessao uuid, p_tabela text
) returns integer language plpgsql as $$
declare n integer;
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_ator, 'role', 'authenticated')::text, true);
  -- Sem isto o teste mede um superusuario, que ignora RLS.
  set local role authenticated;
  if p_tabela = 'corrections' then
    select count(*) into n from public.transcript_corrections
     where session_id = p_sessao;
  elsif p_tabela = 'feedback' then
    select count(*) into n from public.session_feedback where session_id = p_sessao;
  elsif p_tabela = 'transcripts' then
    select count(*) into n from public.session_transcripts where session_id = p_sessao;
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
  pg_temp.visivel('96000000-0000-4000-8000-000000000002',
                  '96000000-0000-4000-8000-0000000000a2', 'corrections'),
  0, 'sem escopo nenhum, a correcao nao e visivel'
);

-- ---------------------------------------------------------------------------
-- CASO A - `multimodal_result` ativo, transcricao NAO compartilhada
--
-- O finding original. `RESULT_SHARING != TRANSCRIPT_SHARING`.
-- ---------------------------------------------------------------------------

insert into public.sharing_permissions (id, connection_id, scope, status)
values (
  '96000000-0000-4000-8000-0000000000f1',
  '96000000-0000-4000-8000-0000000000c1',
  'multimodal_result', 'granted'
);

select is(
  pg_temp.visivel('96000000-0000-4000-8000-000000000002',
                  '96000000-0000-4000-8000-0000000000a1', 'corrections'),
  0, 'CASO A: multimodal_result NAO revela a correcao'
);

-- ---------------------------------------------------------------------------
-- CASO B - consentimento de transcricao ligado, mas SEM o scope
--
-- Consentir e conceder sao duas coisas. Uma nao substitui a outra.
-- ---------------------------------------------------------------------------

select is(
  pg_temp.visivel('96000000-0000-4000-8000-000000000002',
                  '96000000-0000-4000-8000-0000000000a2', 'corrections'),
  0, 'CASO B: consentimento sem o escopo multimodal_transcript nao basta'
);

-- ---------------------------------------------------------------------------
-- CASO C - consentimento + `multimodal_transcript` ativo
-- ---------------------------------------------------------------------------

insert into public.sharing_permissions (id, connection_id, scope, status)
values (
  '96000000-0000-4000-8000-0000000000f2',
  '96000000-0000-4000-8000-0000000000c1',
  'multimodal_transcript', 'granted'
);

select is(
  pg_temp.visivel('96000000-0000-4000-8000-000000000002',
                  '96000000-0000-4000-8000-0000000000a2', 'corrections'),
  1, 'CASO C: com o escopo de transcricao a correcao aparece'
);

-- E a sessao que nunca consentiu transcricao continua fechada, com o MESMO
-- escopo concedido: o portao e por sessao, e nao por profissional.
select is(
  pg_temp.visivel('96000000-0000-4000-8000-000000000002',
                  '96000000-0000-4000-8000-0000000000a1', 'corrections'),
  0, 'a sessao sem consentimento de transcricao continua fechada'
);

-- A transcricao propria aparece pelo mesmo portao: os dois andam juntos.
select is(
  pg_temp.visivel('96000000-0000-4000-8000-000000000002',
                  '96000000-0000-4000-8000-0000000000a2', 'transcripts'),
  1, 'a transcricao e a correcao compartilham o mesmo portao'
);

-- ---------------------------------------------------------------------------
-- CASO G - feedback NUNCA e visivel, em nenhuma combinacao
-- ---------------------------------------------------------------------------

select is(
  pg_temp.visivel('96000000-0000-4000-8000-000000000002',
                  '96000000-0000-4000-8000-0000000000a2', 'feedback'),
  0, 'CASO G: o polegar da pessoa nunca chega ao profissional'
);

-- ---------------------------------------------------------------------------
-- CASO E - janela temporal: a sessao fica FORA do periodo compartilhado
--
-- A policy publicada usava a funcao anterior a Era 3 e ignorava a janela.
-- ---------------------------------------------------------------------------

update public.sharing_permissions
   set data_from = (timezone('utc', now()))::date,
       data_to   = (timezone('utc', now()))::date
 where id = '96000000-0000-4000-8000-0000000000f2';

select is(
  pg_temp.visivel('96000000-0000-4000-8000-000000000002',
                  '96000000-0000-4000-8000-0000000000a2', 'corrections'),
  0, 'CASO E: sessao fora da janela de dados nao entrega a correcao'
);

update public.sharing_permissions
   set data_from = null, data_to = null
 where id = '96000000-0000-4000-8000-0000000000f2';

-- ---------------------------------------------------------------------------
-- CASO E' - permissao expirada
-- ---------------------------------------------------------------------------

update public.sharing_permissions
   set expires_at = timezone('utc', now()) - interval '1 hour'
 where id = '96000000-0000-4000-8000-0000000000f2';

select is(
  pg_temp.visivel('96000000-0000-4000-8000-000000000002',
                  '96000000-0000-4000-8000-0000000000a2', 'corrections'),
  0, 'CASO E: permissao expirada nao entrega a correcao'
);

update public.sharing_permissions
   set expires_at = null
 where id = '96000000-0000-4000-8000-0000000000f2';

-- ---------------------------------------------------------------------------
-- CASO D - escopo revogado, efeito imediato
-- ---------------------------------------------------------------------------

update public.sharing_permissions
   set status = 'revoked', revoked_at = timezone('utc', now())
 where id = '96000000-0000-4000-8000-0000000000f2';

select is(
  pg_temp.visivel('96000000-0000-4000-8000-000000000002',
                  '96000000-0000-4000-8000-0000000000a2', 'corrections'),
  0, 'CASO D: revogar multimodal_transcript some com a correcao na hora'
);

update public.sharing_permissions
   set status = 'granted', revoked_at = null
 where id = '96000000-0000-4000-8000-0000000000f2';

select is(
  pg_temp.visivel('96000000-0000-4000-8000-000000000002',
                  '96000000-0000-4000-8000-0000000000a2', 'corrections'),
  1, 'reconceder devolve a visibilidade'
);

-- ---------------------------------------------------------------------------
-- CASO F - correcao revogada pela pessoa
-- ---------------------------------------------------------------------------

update public.transcript_corrections
   set revoked_at = timezone('utc', now())
 where session_id = '96000000-0000-4000-8000-0000000000a2';

select is(
  pg_temp.visivel('96000000-0000-4000-8000-000000000002',
                  '96000000-0000-4000-8000-0000000000a2', 'corrections'),
  0, 'CASO F: correcao revogada nao viaja'
);

update public.transcript_corrections
   set revoked_at = null
 where session_id = '96000000-0000-4000-8000-0000000000a2';

-- ---------------------------------------------------------------------------
-- RETENCAO - a correcao guarda a PROPRIA copia do texto
--
-- Achado ao corrigir o finding principal: apagar a transcricao tirava o texto
-- do profissional pela porta da transcricao e o deixava de pe pela porta da
-- correcao. O apagamento parecia feito e nao era.
-- ---------------------------------------------------------------------------

update public.session_transcripts
   set status = 'deleted', deleted_at = timezone('utc', now()),
       content = null, word_count = null, voiced_duration_ms = null
 where id = '96000000-0000-4000-8000-0000000000d2';

select is(
  pg_temp.visivel('96000000-0000-4000-8000-000000000002',
                  '96000000-0000-4000-8000-0000000000a2', 'transcripts'),
  0, 'transcricao apagada sai da vista do profissional'
);

select is(
  pg_temp.visivel('96000000-0000-4000-8000-000000000002',
                  '96000000-0000-4000-8000-0000000000a2', 'corrections'),
  0, 'RETENCAO: a copia dentro da correcao sai junto'
);

-- E o titular continua enxergando a propria correcao: apagar a transcricao e
-- uma decisao dele sobre o compartilhamento, e nao sobre o proprio registro.
select is(
  pg_temp.visivel('96000000-0000-4000-8000-000000000001',
                  '96000000-0000-4000-8000-0000000000a2', 'corrections'),
  1, 'o titular continua vendo a propria correcao'
);

select * from finish();
rollback;
