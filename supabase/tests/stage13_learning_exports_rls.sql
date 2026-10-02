begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(49);

-- Estrutura ----------------------------------------------------------------

select has_table('public', 'learning_exports', 'learning_exports existe');
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.learning_exports'::regclass),
  'learning_exports usa RLS forcada'
);
select ok(
  not has_table_privilege('anon', 'public.learning_exports', 'SELECT'),
  'anon nao le learning_exports'
);
-- Historico de governanca nao desaparece: revogacao e estado, nao DELETE.
select ok(
  has_table_privilege('authenticated', 'public.learning_exports', 'SELECT')
  and has_table_privilege('authenticated', 'public.learning_exports', 'INSERT')
  and has_table_privilege('authenticated', 'public.learning_exports', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.learning_exports', 'DELETE'),
  'export nao pode ser apagado pelo dono'
);

-- Governanca, nao conteudo -------------------------------------------------

select is(
  (select count(*)::integer from information_schema.columns
   where table_schema = 'public' and table_name = 'learning_exports'
     and data_type in ('jsonb', 'json')),
  0,
  'export nao guarda payload como deposito generico'
);
select is(
  (select count(*)::integer from information_schema.columns
   where table_schema = 'public' and table_name = 'learning_exports'
     and column_name in (
       'payload', 'content', 'journal', 'transcript', 'media_path',
       'storage_path', 'signed_url', 'email', 'display_name'
     )),
  0,
  'export nao carrega conteudo, midia nem identificador direto'
);
select is(
  (select count(*)::integer from information_schema.columns
   where table_schema = 'public' and table_name = 'learning_exports'
     and data_type = 'bytea'),
  0,
  'export nao guarda BLOB'
);

-- Proveniencia --------------------------------------------------------------

select has_column('public', 'learning_exports', 'report_snapshot_id',
  'export aponta para o snapshot de origem');
select has_column('public', 'learning_exports', 'training_consent_event_id',
  'export registra o consentimento que o autorizou');
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.learning_exports'::regclass
            and conname = 'learning_export_snapshot_belongs_to_owner'),
  'snapshot precisa pertencer ao mesmo dono'
);
select ok(
  (select confkey is not null and array_length(conkey, 1) = 2
   from pg_constraint
   where conrelid = 'public.learning_exports'::regclass
     and conname = 'learning_export_snapshot_belongs_to_owner'),
  'FK do snapshot e composta por id e dono'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.learning_exports'::regclass
            and conname = 'learning_exports_source_schema_version_check'),
  'export fixa a versao do schema de origem'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.learning_exports'::regclass
            and conname = 'learning_exports_analytics_version_check'),
  'export fixa a versao analitica'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.learning_exports'::regclass
            and conname = 'learning_exports_policy_version_check'),
  'export fixa a versao de politica'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.learning_exports'::regclass
            and conname = 'learning_exports_export_schema_version_check'),
  'export fixa a versao do schema de exportacao'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.learning_exports'::regclass
            and conname = 'learning_exports_contract_version_check'),
  'export fixa a versao do contrato PedroCore'
);

-- Fingerprint e idempotencia duravel -----------------------------------------

select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.learning_exports'::regclass
            and conname = 'learning_exports_fingerprint_check'),
  'fingerprint tem formato fixo de sha256'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.learning_exports'::regclass
            and conname = 'learning_export_unique_fingerprint'),
  'mesmo conteudo governado nao exporta duas vezes'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.learning_exports'::regclass
            and conname = 'learning_export_unique_snapshot'),
  'um snapshot produz no maximo um export por politica'
);

-- Lifecycle e coerencia de estado -------------------------------------------

select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.learning_exports'::regclass
            and conname = 'learning_exports_status_check'),
  'status usa catalogo fechado'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.learning_exports'::regclass
            and conname = 'learning_export_exported_shape'),
  'exportado exige candidate, lifecycle, data e qualidade aprovada'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.learning_exports'::regclass
            and conname = 'learning_export_rejected_shape'),
  'rejeitado exige codigo e nunca tem candidate'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.learning_exports'::regclass
            and conname = 'learning_export_revoked_shape'),
  'revogado exige data e motivo'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.learning_exports'::regclass
            and conname = 'learning_export_eligible_shape'),
  'elegivel ainda nao alcancou o PedroCore'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.learning_exports'::regclass
            and conname = 'learning_exports_rejection_code_check'),
  'inelegivel tem codigo proprio, nao erro tecnico'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.learning_exports'::regclass
            and conname = 'learning_exports_revocation_reason_check'),
  'motivo de revogacao usa catalogo fechado'
);

-- Referencia ao Candidate ---------------------------------------------------

select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.learning_exports'::regclass
            and conname = 'learning_exports_candidate_id_check'),
  'candidate_id respeita o formato do PedroCore'
);
select ok(
  exists (select 1 from pg_constraint
          where conrelid = 'public.learning_exports'::regclass
            and conname = 'learning_exports_candidate_lifecycle_check'),
  'lifecycle espelhado usa o catalogo do Dataset Foundation'
);
-- O Candidate continua sendo do PedroCore: a Elyra nao materializa uma copia.
select is(
  (select count(*)::integer from information_schema.tables
   where table_schema = 'public'
     and table_name in ('training_candidates', 'training_example_candidates',
                        'dataset_candidates')),
  0,
  'Elyra nao duplica o Candidate Store'
);

-- Consentimento de treino ---------------------------------------------------

select has_function('public', 'set_training_consent', array['boolean'],
  'consentimento de treino tem RPC propria');
select has_function('public', 'training_consent_active', array['uuid'],
  'consentimento de treino vigente e funcao unica');
select ok(
  not has_function_privilege('anon', 'public.set_training_consent(boolean)', 'EXECUTE'),
  'anon nao concede consentimento de treino'
);
select ok(
  (select prosrc ilike '%training_data%' and prosrc not ilike '%ai_inference%'
   from pg_proc where proname = 'set_training_consent'),
  'consentimento de treino e proposito separado da inferencia'
);
select ok(
  (select prosrc ilike '%revoked%' from pg_proc
   where proname = 'training_consent_active'),
  'revogacao de treino e reavaliada a cada consulta'
);
select ok(
  (select pg_get_expr(polwithcheck, polrelid) ilike '%training_consent_active%'
   from pg_policy
   where polrelid = 'public.learning_exports'::regclass
     and polname = 'learning_exports_insert_own'),
  'export exige consentimento de treino vigente na propria policy'
);
select has_trigger('public', 'learning_exports', 'learning_exports_require_consent',
  'consentimento e verificado tambem por trigger');

-- Elegibilidade multimodal --------------------------------------------------

select ok(
  not exists (select 1 from pg_constraint
              where conrelid = 'public.multimodal_sessions'::regclass
                and conname = 'multimodal_stage11_learning_closed'),
  'o travamento da Stage 11 foi substituido, nao apenas removido'
);
select has_trigger('public', 'multimodal_sessions',
  'multimodal_sessions_training_eligibility',
  'elegibilidade de treino passa por politica explicita');
select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'multimodal_sessions'
     and column_name = 'training_eligibility_consent'),
  'false',
  'elegibilidade de treino continua nascendo desligada'
);
select ok(
  (select prosrc ilike '%training_consent_active%'
   from pg_proc where proname = 'enforce_training_eligibility_policy'),
  'elegibilidade exige consentimento de treino vigente'
);

-- Imutabilidade e finalidade da revogacao -----------------------------------

select has_trigger('public', 'learning_exports', 'learning_exports_protect_contract',
  'identidade do export e imutavel');
select ok(
  (select prosrc ilike '%ELYRA_LEARNING_REVOCATION_IS_FINAL%'
   from pg_proc where proname = 'protect_learning_export_contract'),
  'revogacao e final'
);
select ok(
  (select prosrc ilike '%ELYRA_LEARNING_CANDIDATE_REFERENCE_IMMUTABLE%'
   from pg_proc where proname = 'protect_learning_export_contract'),
  'referencia ao Candidate nao muda depois de atribuida'
);

-- Fronteira profissional ----------------------------------------------------

select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public' and tablename = 'learning_exports'),
  3,
  'learning_exports tem exatamente tres policies, todas do dono'
);
select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public' and tablename = 'learning_exports'
     and policyname like '%professional%'),
  0,
  'nenhum scope profissional alcanca learning'
);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'learning_exports'
      and qual ilike '%professional_access_allowed%'
  ),
  'learning nao consulta a funcao de acesso profissional'
);

-- Audit ---------------------------------------------------------------------

select has_trigger('public', 'learning_exports', 'learning_exports_audit_write',
  'export gera audit');
select ok(
  (select prosrc not ilike '%new.fingerprint%'
      and prosrc not ilike '%new.payload%'
      and prosrc not ilike '%new.report_snapshot_id%'
      and prosrc not ilike '%new.candidate_id%'
   from pg_proc where proname = 'audit_stage13_write'),
  'audit nao transporta fingerprint, payload nem referencia de relatorio'
);
select ok(
  not has_function_privilege('anon', 'public.audit_stage13_write()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.protect_learning_export_contract()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.enforce_learning_export_consent()', 'EXECUTE'),
  'funcoes internas da Stage 13 nao sao expostas ao anon'
);

select * from finish();
rollback;
