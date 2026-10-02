begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(32);

-- ---------------------------------------------------------------------------
-- Estrutura
-- ---------------------------------------------------------------------------

select has_table('public', 'session_feedback', 'session_feedback existe');
select has_table('public', 'transcript_corrections', 'transcript_corrections existe');

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.session_feedback'::regclass),
  'feedback usa RLS forcada'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.transcript_corrections'::regclass),
  'correcao usa RLS forcada'
);

-- O profissional NAO tem policy de leitura sobre avaliacao de produto.
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'session_feedback'
     and policyname ilike '%professional%'),
  0,
  'nao existe caminho de profissional para a avaliacao de produto'
);

-- A correcao TEM caminho profissional, porque ela pertence a transcricao.
select isnt(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'transcript_corrections'
     and policyname ilike '%professional%'),
  0,
  'a correcao acompanha a transcricao compartilhada'
);

select ok(
  (select pg_get_expr(conbin, conrelid) ilike '%training_eligible%'
   from pg_constraint
   where conrelid = 'public.transcript_corrections'::regclass
     and contype = 'c'
     and pg_get_expr(conbin, conrelid) ilike '%training%'
   limit 1)
  or exists (
    select 1 from pg_trigger
    where tgrelid = 'public.transcript_corrections'::regclass
      and tgname = 'transcript_corrections_no_automatic_training'
  ),
  'o banco guarda a regra de que treinamento nunca e automatico'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-0000000000f1', 'dono@elyra.test'),
  ('00000000-0000-4000-a000-0000000000f2', 'outro@elyra.test');

insert into public.multimodal_sessions
  (id, user_id, kind, status, microphone_consent)
values
  ('00000000-0000-4000-b000-0000000000f1',
   '00000000-0000-4000-a000-0000000000f1', 'free', 'completed', true);

insert into public.session_transcripts
  (id, session_id, user_id, status, source, content, word_count, voiced_duration_ms,
   asr_model, asr_quantization, asr_runtime, asr_runtime_version, asr_vad)
values
  ('00000000-0000-4000-c000-0000000000f1',
   '00000000-0000-4000-b000-0000000000f1',
   '00000000-0000-4000-a000-0000000000f1', 'available', 'local_whisper',
   'eu nao consegui terminar', 4, 5000,
   'onnx-community/whisper-base', 'q8', 'transformers.js', '3.7.6', 'silero_vad_v5');

-- ---------------------------------------------------------------------------
-- Avaliacao
-- ---------------------------------------------------------------------------

select lives_ok($$
  insert into public.session_feedback
    (session_id, user_id, target_type, target_id, rating)
  values ('00000000-0000-4000-b000-0000000000f1',
          '00000000-0000-4000-a000-0000000000f1', 'transcription',
          '00000000-0000-4000-c000-0000000000f1', 'positive')
$$, 'avaliacao positiva de transcricao e aceita');

-- Os dois alvos coexistem: avaliar a transcricao nao avalia a interpretacao.
select lives_ok($$
  insert into public.session_feedback
    (session_id, user_id, target_type, rating)
  values ('00000000-0000-4000-b000-0000000000f1',
          '00000000-0000-4000-a000-0000000000f1', 'interpretation', 'negative')
$$, 'transcricao e interpretacao sao avaliadas separadamente');

select throws_ok($$
  insert into public.session_feedback
    (session_id, user_id, target_type, rating)
  values ('00000000-0000-4000-b000-0000000000f1',
          '00000000-0000-4000-a000-0000000000f1', 'transcription', 'negative')
$$, '23505', null, 'uma avaliacao por alvo: insistir nao vira peso');

select throws_ok($$
  insert into public.session_feedback
    (session_id, user_id, target_type, rating, reason)
  values ('00000000-0000-4000-b000-0000000000f1',
          '00000000-0000-4000-a000-0000000000f1', 'transcription', 'positive', 'missing_word')
$$, '23514', null, 'motivo so acompanha recusa');

select throws_ok($$
  insert into public.session_feedback
    (session_id, user_id, target_type, rating, reason)
  values ('00000000-0000-4000-b000-0000000000f1',
          '00000000-0000-4000-a000-0000000000f1', 'interpretation', 'negative', 'missing_word')
$$, '23514', null, 'motivo de transcricao nao descreve interpretacao');

select throws_ok($$
  insert into public.session_feedback
    (session_id, user_id, target_type, rating)
  values ('00000000-0000-4000-b000-0000000000f1',
          '00000000-0000-4000-a000-0000000000f1', 'the_person', 'negative')
$$, '23514', null, 'nao existe alvo fora do vocabulario');

-- ---------------------------------------------------------------------------
-- Correcao
-- ---------------------------------------------------------------------------

select lives_ok($$
  insert into public.transcript_corrections
    (session_id, user_id, transcript_id, original_content, corrected_content,
     original_source, revision)
  values ('00000000-0000-4000-b000-0000000000f1',
          '00000000-0000-4000-a000-0000000000f1',
          '00000000-0000-4000-c000-0000000000f1',
          'eu nao consegui terminar', 'eu nao consegui terminar hoje',
          'local_whisper', 1)
$$, 'correcao humana e aceita como entidade propria');

-- CORRECTION_OVERWRITES_ORIGINAL = 0
select is(
  (select content from public.session_transcripts
   where id = '00000000-0000-4000-c000-0000000000f1'),
  'eu nao consegui terminar',
  'a correcao NAO sobrescreve o texto original do ASR'
);

select is(
  (select original_content from public.transcript_corrections
   where session_id = '00000000-0000-4000-b000-0000000000f1' and revision = 1),
  'eu nao consegui terminar',
  'a correcao guarda o original ao lado do corrigido'
);

select throws_ok($$
  insert into public.transcript_corrections
    (session_id, user_id, original_content, corrected_content, original_source, revision)
  values ('00000000-0000-4000-b000-0000000000f1',
          '00000000-0000-4000-a000-0000000000f1',
          'mesmo texto', 'mesmo texto', 'local_whisper', 2)
$$, '23514', null, 'corrigir para o texto identico nao e correcao');

select throws_ok($$
  insert into public.transcript_corrections
    (session_id, user_id, original_content, corrected_content, original_source, revision)
  values ('00000000-0000-4000-b000-0000000000f1',
          '00000000-0000-4000-a000-0000000000f1',
          'a', 'b', 'local_whisper', 1)
$$, '23505', null, 'uma revisao por numero, sem colisao silenciosa');

-- ---------------------------------------------------------------------------
-- FEEDBACK != TRAINING
-- ---------------------------------------------------------------------------

select is(
  (select training_eligible from public.transcript_corrections
   where session_id = '00000000-0000-4000-b000-0000000000f1' and revision = 1),
  false,
  'a correcao nasce NAO elegivel para treinamento'
);

select throws_ok($$
  insert into public.transcript_corrections
    (session_id, user_id, original_content, corrected_content, original_source,
     revision, training_eligible)
  values ('00000000-0000-4000-b000-0000000000f1',
          '00000000-0000-4000-a000-0000000000f1',
          'x', 'y', 'local_whisper', 9, true)
$$, 'P0001', null, 'correcao nao pode nascer elegivel para treinamento');

select throws_ok($$
  update public.transcript_corrections set training_eligible = true
  where session_id = '00000000-0000-4000-b000-0000000000f1' and revision = 1
$$, 'P0001', null, 'elegibilidade nao e ligada por update direto');

-- Revogacao preserva a linha, e o original continua intacto.
select lives_ok($$
  update public.transcript_corrections
     set revoked_at = timezone('utc', now())
   where session_id = '00000000-0000-4000-b000-0000000000f1' and revision = 1
$$, 'a pessoa pode revogar a propria correcao');

select is(
  (select count(*)::int from public.transcript_corrections
   where session_id = '00000000-0000-4000-b000-0000000000f1'),
  1,
  'revogar preserva a linha, e nao apaga o rastro'
);

select is(
  (select content from public.session_transcripts
   where id = '00000000-0000-4000-c000-0000000000f1'),
  'eu nao consegui terminar',
  'revogar a correcao nao toca no transcript original'
);

-- ---------------------------------------------------------------------------
-- Isolamento entre pessoas (RLS real, sob `authenticated`)
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"00000000-0000-4000-a000-0000000000f2","role":"authenticated"}';

select is(
  (select count(*)::int from public.session_feedback),
  0,
  'outra pessoa nao le a avaliacao de ninguem'
);

select is(
  (select count(*)::int from public.transcript_corrections),
  0,
  'outra pessoa nao le a correcao de ninguem'
);

select throws_ok($$
  insert into public.session_feedback
    (session_id, user_id, target_type, rating)
  values ('00000000-0000-4000-b000-0000000000f1',
          '00000000-0000-4000-a000-0000000000f1', 'transcription', 'negative')
$$, '42501', null, 'ninguem avalia em nome de outra pessoa');

select throws_ok($$
  insert into public.transcript_corrections
    (session_id, user_id, original_content, corrected_content, original_source, revision)
  values ('00000000-0000-4000-b000-0000000000f1',
          '00000000-0000-4000-a000-0000000000f1', 'a', 'b', 'local_whisper', 5)
$$, '42501', null, 'ninguem corrige a transcricao de outra pessoa');

reset role;

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"00000000-0000-4000-a000-0000000000f1","role":"authenticated"}';

select is(
  (select count(*)::int from public.session_feedback),
  2,
  'a dona le as proprias avaliacoes'
);

select is(
  (select count(*)::int from public.transcript_corrections),
  1,
  'a dona le a propria correcao'
);

select lives_ok($$
  delete from public.session_feedback
  where user_id = '00000000-0000-4000-a000-0000000000f1'
    and target_type = 'interpretation'
$$, 'quem avaliou pode desavaliar');

reset role;

select is(
  (select content from public.session_transcripts
   where id = '00000000-0000-4000-c000-0000000000f1'),
  'eu nao consegui terminar',
  'nada disso alterou o transcript original em momento algum'
);

select * from finish();
rollback;
