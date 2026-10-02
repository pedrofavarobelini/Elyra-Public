begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

-- Stage 22-V - o alvo do feedback precisa existir na propria sessao.
--
-- `session_feedback.target_id` aceitava qualquer UUID. A RLS provava que a
-- SESSAO e da pessoa, e nao provava nada sobre o alvo: dava para avaliar uma
-- "transcricao" apontando para o id de uma interpretacao, para a transcricao de
-- outra sessao, ou para uma linha de outra pessoa.
--
-- Nao e vazamento - nada disso permite LER o alvo. E proveniencia falsa: uma
-- avaliacao que diz respeito a uma coisa e aponta para outra, e um dataset
-- futuro herdaria o erro sem saber.

insert into auth.users (id, email) values
  ('97000000-0000-4000-8000-000000000001', 'alvo-dono@elyra.test'),
  ('97000000-0000-4000-8000-000000000002', 'alvo-outro@elyra.test');

insert into public.multimodal_sessions
  (id, user_id, kind, status, microphone_consent, transcription_consent,
   ai_analysis_consent)
values
  ('97000000-0000-4000-8000-0000000000a1',
   '97000000-0000-4000-8000-000000000001', 'free', 'completed', true, true, true),
  -- Segunda sessao da MESMA pessoa: o alvo tem que ser da sessao certa, e nao
  -- so do dono certo.
  ('97000000-0000-4000-8000-0000000000a2',
   '97000000-0000-4000-8000-000000000001', 'free', 'completed', true, true, true),
  ('97000000-0000-4000-8000-0000000000b1',
   '97000000-0000-4000-8000-000000000002', 'free', 'completed', true, true, true);

insert into public.session_transcripts
  (id, session_id, user_id, status, source, content, word_count, voiced_duration_ms)
values
  ('97000000-0000-4000-8000-0000000000d1',
   '97000000-0000-4000-8000-0000000000a1',
   '97000000-0000-4000-8000-000000000001', 'available', 'on_device_speech_api',
   'texto da sessao um', 4, 1000),
  ('97000000-0000-4000-8000-0000000000d2',
   '97000000-0000-4000-8000-0000000000a2',
   '97000000-0000-4000-8000-000000000001', 'available', 'on_device_speech_api',
   'texto da sessao dois', 4, 1000),
  ('97000000-0000-4000-8000-0000000000e1',
   '97000000-0000-4000-8000-0000000000b1',
   '97000000-0000-4000-8000-000000000002', 'available', 'on_device_speech_api',
   'texto de outra pessoa', 4, 1000);

insert into public.session_interpretations
  (id, session_id, user_id, correlation_id, request_fingerprint, provider_used,
   model, payload)
values (
  '97000000-0000-4000-8000-0000000000c1',
  '97000000-0000-4000-8000-0000000000a1',
  '97000000-0000-4000-8000-000000000001',
  'alvo-corr-1', repeat('c', 64), 'mock', 'mock-v1', '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- CASO A - alvo correto
-- ---------------------------------------------------------------------------

select lives_ok($$
  insert into public.session_feedback
    (session_id, user_id, target_type, target_id, rating)
  values ('97000000-0000-4000-8000-0000000000a1',
          '97000000-0000-4000-8000-000000000001', 'transcription',
          '97000000-0000-4000-8000-0000000000d1', 'positive')
$$, 'CASO A: transcricao da propria sessao e aceita');

select lives_ok($$
  insert into public.session_feedback
    (session_id, user_id, target_type, target_id, rating)
  values ('97000000-0000-4000-8000-0000000000a1',
          '97000000-0000-4000-8000-000000000001', 'interpretation',
          '97000000-0000-4000-8000-0000000000c1', 'positive')
$$, 'CASO A: interpretacao da propria sessao e aceita');

delete from public.session_feedback
 where session_id = '97000000-0000-4000-8000-0000000000a1';

-- ---------------------------------------------------------------------------
-- CASOS B e C - tipo cruzado
-- ---------------------------------------------------------------------------

select throws_ok($$
  insert into public.session_feedback
    (session_id, user_id, target_type, target_id, rating)
  values ('97000000-0000-4000-8000-0000000000a1',
          '97000000-0000-4000-8000-000000000001', 'transcription',
          '97000000-0000-4000-8000-0000000000c1', 'negative')
$$, '23514', null, 'CASO B: transcricao apontando para interpretacao e recusada');

select throws_ok($$
  insert into public.session_feedback
    (session_id, user_id, target_type, target_id, rating)
  values ('97000000-0000-4000-8000-0000000000a1',
          '97000000-0000-4000-8000-000000000001', 'interpretation',
          '97000000-0000-4000-8000-0000000000d1', 'negative')
$$, '23514', null, 'CASO C: interpretacao apontando para transcricao e recusada');

-- ---------------------------------------------------------------------------
-- CASO D - alvo de outra sessao da MESMA pessoa
-- ---------------------------------------------------------------------------

select throws_ok($$
  insert into public.session_feedback
    (session_id, user_id, target_type, target_id, rating)
  values ('97000000-0000-4000-8000-0000000000a1',
          '97000000-0000-4000-8000-000000000001', 'transcription',
          '97000000-0000-4000-8000-0000000000d2', 'negative')
$$, '23514', null, 'CASO D: transcricao de outra sessao da mesma pessoa e recusada');

-- ---------------------------------------------------------------------------
-- CASO E - alvo de OUTRA pessoa
-- ---------------------------------------------------------------------------

select throws_ok($$
  insert into public.session_feedback
    (session_id, user_id, target_type, target_id, rating)
  values ('97000000-0000-4000-8000-0000000000a1',
          '97000000-0000-4000-8000-000000000001', 'transcription',
          '97000000-0000-4000-8000-0000000000e1', 'negative')
$$, '23514', null, 'CASO E: transcricao de outra pessoa e recusada');

-- ---------------------------------------------------------------------------
-- CASO F - UUID inexistente
-- ---------------------------------------------------------------------------

select throws_ok($$
  insert into public.session_feedback
    (session_id, user_id, target_type, target_id, rating)
  values ('97000000-0000-4000-8000-0000000000a1',
          '97000000-0000-4000-8000-000000000001', 'transcription',
          '97000000-0000-4000-8000-00000000ffff', 'negative')
$$, '23514', null, 'CASO F: UUID inexistente e recusado');

-- ---------------------------------------------------------------------------
-- CASO G - `null` continua permitido
--
-- E como um alvo que ja nao existe por retencao fica representado. Ausencia
-- declarada, e nao alvo inventado.
-- ---------------------------------------------------------------------------

select lives_ok($$
  insert into public.session_feedback
    (session_id, user_id, target_type, target_id, rating)
  values ('97000000-0000-4000-8000-0000000000a1',
          '97000000-0000-4000-8000-000000000001', 'transcription', null, 'negative')
$$, 'CASO G: alvo ausente (retencao) continua representavel por null');

-- ---------------------------------------------------------------------------
-- A verificacao vale tambem no UPDATE
--
-- So no INSERT deixaria a porta aberta: gravar valido e depois apontar para
-- outro lugar.
-- ---------------------------------------------------------------------------

select throws_ok($$
  update public.session_feedback
     set target_id = '97000000-0000-4000-8000-0000000000e1'
   where session_id = '97000000-0000-4000-8000-0000000000a1'
     and target_type = 'transcription'
$$, '23514', null, 'UPDATE tambem e verificado, e nao so o INSERT');

-- ---------------------------------------------------------------------------
-- Estrutura
-- ---------------------------------------------------------------------------

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.session_feedback'::regclass
      and tgname = 'session_feedback_target_integrity'
      and not tgisinternal
  ),
  'o trigger de integridade do alvo existe'
);

select ok(
  (select prosecdef from pg_proc
   where oid = 'public.session_feedback_target_belongs_to_session()'::regprocedure),
  'a funcao roda como definer para poder enxergar o alvo'
);

-- O mesmo endurecimento da funcao canonica de autorizacao profissional: se um
-- dia ela mudar, esta acompanha, em vez de guardar uma string literal que
-- envelhece sozinha.
select is(
  (select proconfig from pg_proc
   where oid = 'public.session_feedback_target_belongs_to_session()'::regprocedure),
  (select proconfig from pg_proc
   where oid = 'public.professional_session_allowed_on(uuid,text,uuid)'::regprocedure),
  'search_path e endurecido como na funcao canonica - o que torna definer aceitavel'
);

select * from finish();
rollback;
