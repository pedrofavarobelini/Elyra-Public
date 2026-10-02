begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(14);

-- ---------------------------------------------------------------------------
-- Proveniencia do ASR (Stage 22-V).
--
-- O finding: `source` tinha um unico valor legal e o `default` respondia por
-- todos os motores, entao uma transcricao do Whisper local era gravada dizendo
-- que veio da API nativa do navegador.
-- ---------------------------------------------------------------------------

select has_column('public', 'session_transcripts', 'asr_model', 'asr_model existe');
select has_column('public', 'session_transcripts', 'asr_quantization', 'asr_quantization existe');
select has_column('public', 'session_transcripts', 'asr_runtime', 'asr_runtime existe');
select has_column('public', 'session_transcripts', 'asr_runtime_version', 'asr_runtime_version existe');
select has_column('public', 'session_transcripts', 'asr_vad', 'asr_vad existe');

-- Os dois motores sao distinguiveis, e o valor historico sobrevive.
select ok(
  (select pg_get_constraintdef(oid) ilike '%local_whisper%'
      and pg_get_constraintdef(oid) ilike '%native_speech_recognition%'
      and pg_get_constraintdef(oid) ilike '%on_device_speech_api%'
   from pg_constraint
   where conrelid = 'public.session_transcripts'::regclass
     and conname = 'session_transcripts_source_check'),
  'os dois motores sao distinguiveis e o valor historico continua legal'
);

select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.session_transcripts'::regclass
            and conname = 'session_transcript_provenance_shape'),
  'a forma da proveniencia e verificada pelo banco'
);

-- Nenhum campo de confianca entrou junto: PROVENANCE != ACCURACY.
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'session_transcripts'
      and column_name in ('asr_confidence', 'confidence', 'accuracy', 'asr_accuracy', 'wer', 'cer')
  ),
  'proveniencia nao carrega confianca nem taxa de erro'
);

-- Fixtures -------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-0000000000a1', 'prov@elyra.test');
-- O perfil e criado por trigger em auth.users; inseri-lo aqui colidiria.
insert into public.multimodal_sessions
  (id, user_id, kind, status, microphone_consent)
  values ('00000000-0000-4000-b000-0000000000b1',
          '00000000-0000-4000-a000-0000000000a1', 'free', 'completed', true);

-- Whisper local COM proveniencia completa: aceito.
select lives_ok($$
  insert into public.session_transcripts
    (session_id, user_id, status, source, content, word_count, voiced_duration_ms,
     asr_model, asr_quantization, asr_runtime, asr_runtime_version, asr_vad)
  values ('00000000-0000-4000-b000-0000000000b1',
          '00000000-0000-4000-a000-0000000000a1', 'available', 'local_whisper',
          'texto', 1, 1000,
          'onnx-community/whisper-base', 'q8', 'transformers.js', '3.7.6', 'silero_vad_v5')
$$, 'Whisper local com proveniencia completa e aceito');

-- TEST_FAILS_IF_PROVENANCE_IS_REMOVED
select throws_ok($$
  update public.session_transcripts set asr_model = null
  where session_id = '00000000-0000-4000-b000-0000000000b1'
$$, '23514', null, 'Whisper local sem modelo e recusado');

select throws_ok($$
  update public.session_transcripts set asr_runtime_version = null
  where session_id = '00000000-0000-4000-b000-0000000000b1'
$$, '23514', null, 'Whisper local sem versao de runtime e recusado');

select throws_ok($$
  update public.session_transcripts set asr_vad = null
  where session_id = '00000000-0000-4000-b000-0000000000b1'
$$, '23514', null, 'Whisper local sem VAD e recusado');

-- O motor nativo nao pode declarar detalhe que o navegador nao publica.
select throws_ok($$
  update public.session_transcripts
     set source = 'native_speech_recognition'
   where session_id = '00000000-0000-4000-b000-0000000000b1'
$$, '23514', null, 'motor nativo nao carrega detalhe de modelo');

-- Provider externo continua recusado.
select throws_ok($$
  update public.session_transcripts set source = 'openai_whisper_api'
  where session_id = '00000000-0000-4000-b000-0000000000b1'
$$, '23514', null, 'provider externo continua recusado');

select * from finish();
rollback;
