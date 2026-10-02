begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(49);

-- Estrutura ----------------------------------------------------------------

select has_table('public', 'session_transcripts', 'session_transcripts existe');
select has_table('public', 'derived_features', 'derived_features existe');
select has_table('public', 'session_interpretations', 'session_interpretations existe');

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.session_transcripts'::regclass),
  'transcricao usa RLS forcada'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.derived_features'::regclass),
  'sinais usam RLS forcada'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.session_interpretations'::regclass),
  'interpretacao usa RLS forcada'
);

select ok(
  not has_table_privilege('anon', 'public.session_transcripts', 'SELECT')
  and not has_table_privilege('anon', 'public.derived_features', 'SELECT')
  and not has_table_privilege('anon', 'public.session_interpretations', 'SELECT'),
  'anon nao le transcricao, sinal ou interpretacao'
);

-- Interpretacao e append-only para o dono: sem UPDATE, sem DELETE.
select ok(
  has_table_privilege('authenticated', 'public.session_interpretations', 'SELECT')
  and has_table_privilege('authenticated', 'public.session_interpretations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.session_interpretations', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.session_interpretations', 'DELETE'),
  'interpretacao e append-only para o dono'
);

-- Separacao de entidades ----------------------------------------------------

select is(
  (select count(*)::integer from information_schema.columns
   where table_schema = 'public' and table_name = 'derived_features'
     and column_name in ('content', 'transcript', 'text')),
  0,
  'sinal derivado nao carrega transcricao'
);
select is(
  (select count(*)::integer from information_schema.columns
   where table_schema = 'public' and table_name = 'session_transcripts'
     and column_name in ('signal_name', 'value', 'personal_baseline_mean')),
  0,
  'transcricao nao carrega sinal'
);
select is(
  (select count(*)::integer from information_schema.columns
   where table_schema = 'public'
     and table_name in ('session_transcripts', 'derived_features',
                        'session_interpretations')
     and data_type = 'bytea'),
  0,
  'Stage 12 nao guarda BLOB de midia'
);
select is(
  (select count(*)::integer from information_schema.columns
   where table_schema = 'public'
     and table_name in ('session_transcripts', 'derived_features',
                        'session_interpretations')
     and column_name in ('storage_path', 'media_path', 'signed_url')),
  0,
  'Stage 12 nao referencia caminho de Storage'
);

-- Vocabulario fechado: emocao nao tem nome --------------------------------

select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.derived_features'::regclass
            and conname = 'derived_features_signal_name_check'),
  'vocabulario de sinais e fechado'
);
select ok(
  (select pg_get_constraintdef(oid) not ilike '%emotion%'
      and pg_get_constraintdef(oid) not ilike '%sad%'
      and pg_get_constraintdef(oid) not ilike '%anx%'
      and pg_get_constraintdef(oid) not ilike '%mood%'
   from pg_constraint
   where conrelid = 'public.derived_features'::regclass
     and conname = 'derived_features_signal_name_check'),
  'nenhum sinal nomeia emocao, humor ou ansiedade'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.derived_features'::regclass
            and conname = 'derived_feature_unit_matches_signal'),
  'unidade precisa ser coerente com o sinal'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.derived_features'::regclass
            and conname = 'derived_feature_index_domain'),
  'indice normalizado respeita 0-1'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.derived_features'::regclass
            and conname = 'derived_feature_not_captured_shape'),
  'sinal nao capturado nao carrega valor'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.derived_features'::regclass
            and conname = 'derived_feature_baseline_shape'),
  'comparacao exige baseline pessoal real'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.derived_features'::regclass
            and conname = 'derived_feature_unique_per_session'),
  'um sinal por sessao'
);

-- Transcricao ---------------------------------------------------------------

select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.session_transcripts'::regclass
            and conname = 'session_transcript_content_shape'),
  'texto so existe quando a transcricao esta disponivel'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.session_transcripts'::regclass
            and conname = 'session_transcript_deleted_shape'),
  'transcricao apagada registra o momento'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.session_transcripts'::regclass
            and conname = 'session_transcripts_source_check'),
  'fonte da transcricao usa lista fechada'
);
-- A intencao original desta asserção e "nenhum provider externo transcreve".
-- Ela era escrita como `not ilike '%whisper%'` porque, quando foi escrita, o
-- unico Whisper concebivel era a API da OpenAI. A Stage 22-V introduziu o
-- Whisper LOCAL, que roda no aparelho e nunca ve a rede: recusa-lo aqui
-- protegeria a letra da regra contra o proprio caso que ela existe para
-- permitir. O que continua proibido e o que sai do aparelho.
select ok(
  (select pg_get_constraintdef(oid) ilike '%on_device_speech_api%'
      and pg_get_constraintdef(oid) not ilike '%gemini%'
      and pg_get_constraintdef(oid) not ilike '%openai%'
      and pg_get_constraintdef(oid) not ilike '%deepgram%'
      and pg_get_constraintdef(oid) not ilike '%azure%'
      and pg_get_constraintdef(oid) not ilike '%whisper_api%'
      and pg_get_constraintdef(oid) not ilike '%remote%'
      and pg_get_constraintdef(oid) not ilike '%cloud%'
   from pg_constraint
   where conrelid = 'public.session_transcripts'::regclass
     and conname = 'session_transcripts_source_check'),
  'transcricao e somente on-device, sem provider externo'
);
select ok(
  exists (select 1 from pg_indexes
          where schemaname = 'public' and tablename = 'session_transcripts'
            and indexdef ilike '%session_id%' and indexdef ilike '%UNIQUE%'),
  'uma transcricao por sessao'
);

-- Interpretacao -------------------------------------------------------------

select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.session_interpretations'::regclass
            and conname = 'session_interpretation_unique_fingerprint'),
  'idempotencia duravel por fingerprint'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.session_interpretations'::regclass
            and conname = 'session_interpretations_contract_version_check'),
  'interpretacao fixa a versao do contrato'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.session_interpretations'::regclass
            and conname = 'session_interpretations_provider_used_check'),
  'provider registrado usa formato fechado (ADR-0034)'
);

-- Versionamento do extrator -------------------------------------------------

select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.derived_features'::regclass
            and conname = 'derived_features_extractor_version_check'),
  'sinal registra a versao do extrator'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.session_transcripts'::regclass
            and conname = 'session_transcripts_extractor_version_check'),
  'transcricao registra a versao do extrator'
);

-- Jobs ----------------------------------------------------------------------

select ok(
  (select pg_get_constraintdef(oid) ilike '%transcript_ingest%'
      and pg_get_constraintdef(oid) ilike '%signal_extraction%'
      and pg_get_constraintdef(oid) ilike '%session_interpretation%'
      and pg_get_constraintdef(oid) ilike '%upload_finalize%'
      and pg_get_constraintdef(oid) ilike '%media_cleanup%'
   from pg_constraint
   where conrelid = 'public.processing_jobs'::regclass
     and conname = 'processing_jobs_job_kind_check'),
  'jobs Stage 12 coexistem com os jobs 11A'
);

-- Triggers de contrato e audit ---------------------------------------------

select has_trigger('public', 'session_transcripts',
  'session_transcripts_protect_contract', 'dono da transcricao e imutavel');
select has_trigger('public', 'derived_features',
  'derived_features_protect_contract', 'identidade do sinal e imutavel');
select has_trigger('public', 'session_interpretations',
  'session_interpretations_reject_update', 'interpretacao e imutavel');
select has_trigger('public', 'session_transcripts',
  'session_transcripts_audit_write', 'transcricao gera audit');
select has_trigger('public', 'derived_features',
  'derived_features_audit_write', 'sinal gera audit');
select has_trigger('public', 'session_interpretations',
  'session_interpretations_audit_write', 'interpretacao gera audit');

-- O audit registra o evento, nunca o conteudo.
select ok(
  (select prosrc not ilike '%new.content%'
      and prosrc not ilike '%new.payload%'
      and prosrc not ilike '%new.value%'
   from pg_proc where proname = 'audit_stage12_write'),
  'audit nao transporta transcricao, payload ou valor de sinal'
);

-- Consentimento -------------------------------------------------------------

select has_function('public', 'ai_inference_consent_active', array['uuid'],
  'consentimento ativo de inferencia e funcao unica');
select ok(
  not has_function_privilege('anon', 'public.ai_inference_consent_active(uuid)', 'EXECUTE'),
  'anon nao avalia consentimento'
);
select ok(
  (select prosrc ilike '%revoked%' from pg_proc
   where proname = 'ai_inference_consent_active'),
  'revogacao e reavaliada a cada consulta'
);

select ok(
  (select pg_get_expr(polwithcheck, polrelid) ilike '%transcription_consent%'
      and pg_get_expr(polwithcheck, polrelid) ilike '%microphone_consent%'
   from pg_policy
   where polrelid = 'public.session_transcripts'::regclass
     and polname = 'session_transcripts_insert_own'),
  'transcricao exige consentimento proprio e microfone'
);
select ok(
  (select pg_get_expr(polwithcheck, polrelid) ilike '%ai_analysis_consent%'
   from pg_policy
   where polrelid = 'public.derived_features'::regclass
     and polname = 'derived_features_insert_own'),
  'sinal exige consentimento de analise multimodal'
);
select ok(
  (select pg_get_expr(polwithcheck, polrelid) ilike '%ai_inference_consent_active%'
   from pg_policy
   where polrelid = 'public.session_interpretations'::regclass
     and polname = 'session_interpretations_insert_own'),
  'interpretacao exige consentimento de inferencia vigente'
);

-- Fronteira profissional ----------------------------------------------------

select ok(
  (select pg_get_expr(polqual, polrelid) ilike '%multimodal_transcript%'
      and pg_get_expr(polqual, polrelid) ilike '%share_transcript_consent%'
   from pg_policy
   where polrelid = 'public.session_transcripts'::regclass
     and polname = 'session_transcripts_select_professional'),
  'profissional le transcricao somente pelo scope de transcricao'
);
select ok(
  (select pg_get_expr(polqual, polrelid) ilike '%multimodal_result%'
   from pg_policy
   where polrelid = 'public.derived_features'::regclass
     and polname = 'derived_features_select_professional'),
  'profissional le sinal somente pelo scope de resultado'
);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('session_transcripts', 'derived_features',
                        'session_interpretations')
      and policyname like '%professional%'
      and cmd <> 'SELECT'
  ),
  'profissional nunca escreve transcricao, sinal ou interpretacao'
);

-- Learning permanece fora das entidades da Stage 12 -------------------------

select is(
  (select count(*)::integer from information_schema.columns
   where table_schema = 'public'
     and table_name in ('session_transcripts', 'derived_features',
                        'session_interpretations')
     and column_name in (
       'training_eligibility_consent', 'training_consent', 'fingerprint',
       'candidate_id', 'exported_at'
     )),
  0,
  'entidades da Stage 12 nao carregam estado de learning'
);
select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public' and tablename = 'learning_exports'
     and policyname like '%professional%'),
  0,
  'learning nunca e alcancado por scope profissional'
);

select ok(
  not has_function_privilege('anon', 'public.audit_stage12_write()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.protect_session_transcript_contract()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.protect_derived_feature_contract()', 'EXECUTE'),
  'funcoes internas da Stage 12 nao sao expostas ao anon'
);

select * from finish();
rollback;
