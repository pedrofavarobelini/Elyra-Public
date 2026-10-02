begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(39);

select has_table('public', 'multimodal_sessions', 'multimodal_sessions existe');
select has_table('public', 'media_assets', 'media_assets existe');
select has_table('public', 'processing_jobs', 'processing_jobs existe');
select has_column('public', 'user_preferences', 'sessions_enabled', 'ativacao do modulo e preferencia separada');

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.multimodal_sessions'::regclass), 'sessions usa RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.media_assets'::regclass), 'assets usa RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.processing_jobs'::regclass), 'jobs usa RLS forcada');

select ok(
  not has_table_privilege('anon', 'public.multimodal_sessions', 'SELECT')
  and not has_table_privilege('anon', 'public.media_assets', 'SELECT')
  and not has_table_privilege('anon', 'public.processing_jobs', 'SELECT'),
  'anon nao le dominio multimodal'
);
select ok(
  has_table_privilege('authenticated', 'public.multimodal_sessions', 'SELECT')
  and has_table_privilege('authenticated', 'public.multimodal_sessions', 'INSERT')
  and has_table_privilege('authenticated', 'public.multimodal_sessions', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.multimodal_sessions', 'DELETE'),
  'sessao mantem tombstone e escrita sob RLS'
);
select ok(
  has_table_privilege('authenticated', 'public.media_assets', 'SELECT')
  and has_table_privilege('authenticated', 'public.media_assets', 'INSERT')
  and has_table_privilege('authenticated', 'public.media_assets', 'UPDATE')
  and has_table_privilege('authenticated', 'public.media_assets', 'DELETE'),
  'asset permite cleanup somente sob RLS'
);
select ok(
  has_table_privilege('authenticated', 'public.processing_jobs', 'SELECT')
  and has_table_privilege('authenticated', 'public.processing_jobs', 'INSERT')
  and has_table_privilege('authenticated', 'public.processing_jobs', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.processing_jobs', 'DELETE'),
  'job e minimo e owner-only'
);

select ok(exists (select 1 from pg_constraint where conrelid = 'public.multimodal_sessions'::regclass and conname = 'multimodal_sessions_status_check'), 'status de sessao usa catalogo fechado');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.multimodal_sessions'::regclass and conname = 'multimodal_session_has_capture_consent'), 'sessao exige captura explicita');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.multimodal_sessions'::regclass and conname = 'multimodal_transcription_requires_microphone'), 'transcricao exige microfone');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.multimodal_sessions'::regclass and conname = 'multimodal_share_transcript_requires_transcription'), 'sharing de transcricao nao herda consentimento');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.multimodal_sessions'::regclass and conname = 'multimodal_share_original_requires_storage'), 'sharing original exige Storage');
select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'multimodal_sessions'
     and column_name = 'training_eligibility_consent'),
  'false',
  'elegibilidade de treino nasce desligada'
);
select ok(exists (select 1 from pg_constraint where conrelid = 'public.media_assets'::regclass and conname = 'media_assets_media_kind_check'), 'asset e independente por media_kind');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.media_assets'::regclass and conname = 'media_assets_mime_type_check'), 'MIME usa lista fechada');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.media_assets'::regclass and conname = 'media_assets_size_bytes_check'), 'asset respeita limite de tamanho');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.media_assets'::regclass and conname = 'media_asset_path_is_private'), 'path nao aceita URL publica');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.processing_jobs'::regclass and conname = 'processing_jobs_job_kind_check'), 'job_kind usa catalogo fechado');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.processing_jobs'::regclass and conname = 'processing_job_status_shape'), 'lifecycle do job e consistente');

select is(
  (select count(*)::integer from information_schema.columns where table_schema = 'public' and table_name in ('multimodal_sessions', 'media_assets', 'processing_jobs') and data_type = 'bytea'),
  0,
  'PostgreSQL nao armazena BLOB de midia'
);
select is(
  (select count(*)::integer from information_schema.columns
   where table_schema = 'public'
     and table_name in ('multimodal_sessions', 'media_assets', 'processing_jobs')
     and column_name in (
       'content', 'transcript', 'transcript_text', 'signal_name', 'value',
       'personal_baseline_mean', 'word_count'
     )),
  0,
  'captura permanece separada de transcricao e sinais derivados'
);
select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename in ('multimodal_sessions', 'media_assets', 'processing_jobs')),
  12,
  'dominio multimodal possui doze policies explicitas'
);
select ok(exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'private_bucket_read_shared_multimodal'), 'Storage compartilhado exige policy explicita');
select is((select public from storage.buckets where id = 'elyra-private'), false, 'bucket permanece privado');
select is((select file_size_limit::bigint from storage.buckets where id = 'elyra-private'), 33554432::bigint, 'bucket limita objeto a 32 MiB');
select ok(
  (select column_default ilike '%7 days%' from information_schema.columns where table_schema = 'public' and table_name = 'media_assets' and column_name = 'retention_until'),
  'retencao raw de 7 dias segue ADR-0004'
);
select is(
  (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'user_preferences' and column_name = 'sessions_enabled'),
  'false',
  'modulo nasce desligado'
);

select has_trigger('public', 'multimodal_sessions', 'multimodal_sessions_protect_contract', 'contrato da sessao e imutavel');
select has_trigger('public', 'media_assets', 'media_assets_protect_contract', 'contrato do asset e imutavel');
select has_trigger('public', 'multimodal_sessions', 'multimodal_sessions_audit_write', 'sessao gera audit sanitizado');
select has_trigger('public', 'media_assets', 'media_assets_audit_write', 'asset gera audit sanitizado');
select has_index('public', 'multimodal_sessions', 'multimodal_sessions_owner_started_idx', 'lista de sessoes tem indice');
select has_index('public', 'media_assets', 'media_assets_retention_idx', 'expurgo por retencao tem indice');
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('multimodal_sessions', 'media_assets')
      and policyname like '%professional%'
      and cmd <> 'SELECT'
  ),
  'profissional nunca muta sessao ou asset'
);
select ok(
  not has_function_privilege('anon', 'public.protect_multimodal_session_contract()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.protect_media_asset_contract()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.audit_stage11_write()', 'EXECUTE'),
  'funcoes internas nao sao expostas ao anon'
);

select * from finish();
rollback;
