-- Stage 22-V - o detalhe temporal aceita o extrator que a Stage passou a usar.
--
-- Regressao de defeito fisico: a migration da propria Stage moveu o conjunto de
-- sinais para `elyra-signals/v3` e atualizou o `check` de tres tabelas, mas nao
-- o de `session_transcript_segments`. O servico gravava `v3`, o banco recusava
-- com `23514`, e o servico degradava para `temporal_detail_failed` — falha
-- contida, e por isso silenciosa. Nas tres sessoes fisicas de 11/09 nenhum
-- segmento foi persistido.
--
-- O que este arquivo prova:
--   1. `v3` — a versao que o codigo realmente grava — e aceita;
--   2. `v1` e `v2` continuam aceitas: linha historica diz qual aritmetica a
--      produziu, e reescrever isso apagaria proveniencia real;
--   3. versao arbitraria continua recusada — a correcao nao virou curinga;
--   4. `elyra-visual/v1` continua recusada aqui: landmark nao produz texto;
--   5. RLS e as policies da tabela seguem exatamente como estavam.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(9);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000', '93000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'stage22v-segmento@elyra.invalid', null,
  timezone('utc', now()), '', '', '', '', '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Cliente Segmento"}'::jsonb,
  timezone('utc', now()), timezone('utc', now())
);

insert into public.multimodal_sessions (
  id, user_id, kind, status, microphone_consent, transcription_consent,
  ai_analysis_consent
)
values (
  '93000000-0000-4000-8000-0000000000a1',
  '93000000-0000-4000-8000-000000000001',
  'guided', 'completed', true, true, true
);

-- 1. A versao que o codigo grava hoje.
select lives_ok(
  $$insert into public.session_transcript_segments
      (session_id, user_id, segment_index, content, start_offset_ms,
       recognized_at_offset_ms, extractor_version)
    values ('93000000-0000-4000-8000-0000000000a1',
            '93000000-0000-4000-8000-000000000001',
            0, 'trecho reconhecido', 0, 1200, 'elyra-signals/v3')$$,
  'segmento com elyra-signals/v3 e aceito'
);

select is(
  (select extractor_version from public.session_transcript_segments
   where session_id = '93000000-0000-4000-8000-0000000000a1' and segment_index = 0),
  'elyra-signals/v3',
  'a versao gravada e a que foi enviada, e nao o default da coluna'
);

-- 2. Historico preservado.
select lives_ok(
  $$insert into public.session_transcript_segments
      (session_id, user_id, segment_index, content, start_offset_ms,
       recognized_at_offset_ms, extractor_version)
    values ('93000000-0000-4000-8000-0000000000a1',
            '93000000-0000-4000-8000-000000000001',
            1, 'trecho antigo', 1200, 2400, 'elyra-signals/v1')$$,
  'elyra-signals/v1 continua aceito'
);

select lives_ok(
  $$insert into public.session_transcript_segments
      (session_id, user_id, segment_index, content, start_offset_ms,
       recognized_at_offset_ms, extractor_version)
    values ('93000000-0000-4000-8000-0000000000a1',
            '93000000-0000-4000-8000-000000000001',
            2, 'trecho anterior', 2400, 3600, 'elyra-signals/v2')$$,
  'elyra-signals/v2 continua aceito'
);

-- 3. A correcao nao virou curinga.
select throws_ok(
  $$insert into public.session_transcript_segments
      (session_id, user_id, segment_index, content, start_offset_ms,
       recognized_at_offset_ms, extractor_version)
    values ('93000000-0000-4000-8000-0000000000a1',
            '93000000-0000-4000-8000-000000000001',
            3, 'trecho', 3600, 4800, 'elyra-signals/v9')$$,
  '23514', null,
  'versao nao revisada continua recusada'
);

-- 4. Segmento nao tem versao visual: landmark nao produz texto.
select throws_ok(
  $$insert into public.session_transcript_segments
      (session_id, user_id, segment_index, content, start_offset_ms,
       recognized_at_offset_ms, extractor_version)
    values ('93000000-0000-4000-8000-0000000000a1',
            '93000000-0000-4000-8000-000000000001',
            4, 'trecho', 4800, 6000, 'elyra-visual/v1')$$,
  '23514', null,
  'extrator visual continua recusado no detalhe de transcricao'
);

-- 5. A migration e aditiva: autorizacao intocada.
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.session_transcript_segments'::regclass),
  'RLS continua habilitada e forcada'
);

select set_eq(
  $$select policyname::text from pg_policies
    where schemaname = 'public' and tablename = 'session_transcript_segments'$$,
  $$values ('session_transcript_segments_select_own'),
           ('session_transcript_segments_insert_own'),
           ('session_transcript_segments_delete_own'),
           ('session_transcript_segments_select_professional')$$,
  'as policies da tabela continuam as mesmas'
);

select is(
  (select count(*)::int from public.session_transcript_segments
   where session_id = '93000000-0000-4000-8000-0000000000a1'),
  3,
  'apenas os tres segmentos validos foram gravados'
);

select * from finish();
rollback;
