-- Stage 29 / Verificacao profissional V2 — ZERO-COST-FIRST, provider-independent,
-- fail-closed (ADR-0028).
--
-- O que muda:
-- 1. Evidencia estruturada por fato (`professional_verification_evidence`),
--    gravada SO pelo executor confiavel do servidor (service_role, RPC `_for`).
--    O profissional nunca grava a propria evidencia: seria aprovar a si mesmo.
-- 2. Decisao automatica (`apply_automated_verification_for`), que o banco so
--    aceita se os gates obrigatorios estiverem PROVADOS por evidencia aceita,
--    fresca, da mesma submissao. Fonte de QA/demonstracao so conta com o
--    interruptor de ambiente local ligado (default: desligado).
-- 3. Snapshot local do cadastro e-MEC (dado aberto oficial, custo zero).
--
-- Provider pago nunca e gate: o banco nao conhece "InfoSimples" nem "Datavalid",
-- so tipos de fonte. Ausencia de provider = falta de evidencia = fila humana.
--
-- Aditiva. Constraints existentes so GANHAM um ramo (fonte automatizada);
-- toda linha atual continua valida.

-- ---------------------------------------------------------------------------
-- 1. Configuracao de runtime (singleton)
-- ---------------------------------------------------------------------------

create table public.professional_verification_settings (
  singleton boolean primary key default true check (singleton),
  -- Evidencia de fixture de QA ou de demonstracao local pode decidir? So em
  -- banco local de QA. Producao: false, e nenhuma RPC de usuario muda isto.
  accept_fixture_evidence boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.professional_verification_settings (singleton) values (true);

alter table public.professional_verification_settings enable row level security;
alter table public.professional_verification_settings force row level security;
revoke all on table public.professional_verification_settings from public, anon, authenticated;
grant select, update on table public.professional_verification_settings to service_role;

comment on table public.professional_verification_settings is
  'Interruptores da verificacao automatica. accept_fixture_evidence e SO para QA local.';

-- ---------------------------------------------------------------------------
-- 2. Evidencia
-- ---------------------------------------------------------------------------

create table public.professional_verification_evidence (
  id uuid primary key default gen_random_uuid(),
  professional_user_id uuid not null references public.professional_profiles(user_id) on delete cascade,
  -- Numero da submissao do onboarding em que a evidencia foi coletada
  -- (0 = semeadura local/demonstracao). Evidencia de envio antigo nao decide.
  submission integer not null check (submission >= 0),
  fact_type text not null check (fact_type in (
    'auth_account', 'required_terms', 'registry_format', 'identity_match',
    'professional_registry', 'registry_holder_match', 'registry_status',
    'education', 'experience', 'certification'
  )),
  source_type text not null check (source_type in (
    'official_registry',   -- consulta individual em fonte oficial do conselho
    'official_open_data',  -- dado aberto oficial (ex.: snapshot e-MEC)
    'local_evidence',      -- fato da propria Elyra (sessao, declaracao, formato)
    'optional_provider',   -- provider opcional configurado (pago ou nao)
    'human_review',        -- conferencia humana registrada
    'demo_local',          -- semeadura da demonstracao local
    'qa_fixture'           -- fixture deterministica de QA local
  )),
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{2,40}$'),
  status text not null check (status in (
    'PASS', 'FAIL', 'MISMATCH', 'INSUFFICIENT', 'UNKNOWN', 'UNVERIFIED', 'DECLARED_ONLY',
    'SOURCE_UNAVAILABLE', 'NETWORK_ERROR', 'CREDENTIAL_EXPIRED', 'DOCUMENT_UNREADABLE',
    'UNSUPPORTED_FORMAT', 'LOW_CONFIDENCE', 'DUPLICATE', 'TAMPERED', 'REPLAY', 'NOT_CONFIGURED'
  )),
  -- Codigo curto, nunca texto livre, nunca dado pessoal.
  detail text check (detail ~ '^[a-z0-9_:.-]{1,64}$'),
  assurance text check (assurance in (
    'authenticated', 'identity_declared', 'identity_document_crosschecked', 'identity_strongly_verified'
  )),
  -- sha256 hex do valor conferido (ex.: nome normalizado + registro). Nunca o valor.
  value_digest text check (value_digest ~ '^[0-9a-f]{64}$'),
  confidence numeric(4, 3) check (confidence between 0 and 1),
  checked_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz,
  -- V2: bruto nunca e retido (analise efemera). A coluna existe para a regra
  -- ser explicita e testavel, nao para ser ligada.
  raw_evidence_retained boolean not null default false check (not raw_evidence_retained),
  retention_until timestamptz,
  policy_version text not null check (policy_version ~ '^[a-z0-9_.-]{3,40}$'),
  created_at timestamptz not null default timezone('utc', now()),
  constraint professional_verification_evidence_expiry check (expires_at is null or expires_at > checked_at),
  constraint professional_verification_evidence_assurance_fact check (
    assurance is null or fact_type = 'identity_match'
  )
);

comment on table public.professional_verification_evidence is
  'Evidencia estruturada da verificacao profissional (ADR-0028). Sem documento, CPF, resposta bruta ou texto livre. Escrita so pelo executor confiavel.';

create index professional_verification_evidence_lookup_idx
  on public.professional_verification_evidence (professional_user_id, submission, fact_type);
create index professional_verification_evidence_retention_idx
  on public.professional_verification_evidence (retention_until) where retention_until is not null;

alter table public.professional_verification_evidence enable row level security;
alter table public.professional_verification_evidence force row level security;
-- Nenhum acesso direto de usuario: dono e reviewer leem por projecao (RPC).
revoke all on table public.professional_verification_evidence from public, anon, authenticated;
grant select, insert, delete on table public.professional_verification_evidence to service_role;

-- ---------------------------------------------------------------------------
-- 3. Trilha de verificacao aceita a fonte automatizada
-- ---------------------------------------------------------------------------

alter table public.professional_verifications
  drop constraint professional_verifications_source_check;
alter table public.professional_verifications
  add constraint professional_verifications_source_check check (source in (
    'elyra_workflow',
    'cfp_cadastro_nacional_manual',
    'crp_regional_manual',
    'system',
    'elyra_precheck',
    'elyra_automated_verification'
  ));

-- Aprovacao continua exigindo digest e validade. Ganha UM ramo: sistema, fonte
-- automatizada. A RPC abaixo e o unico caminho para gravar esse ramo.
alter table public.professional_verifications
  drop constraint professional_verifications_approval_shape;
alter table public.professional_verifications
  add constraint professional_verifications_approval_shape check (
    to_status <> 'verified'
    or (
      actor_role = 'reviewer'
      and source in ('cfp_cadastro_nacional_manual', 'crp_regional_manual')
      and evidence_digest is not null
      and review_due_at is not null
    )
    or (
      actor_role = 'system'
      and source = 'elyra_automated_verification'
      and evidence_digest is not null
      and review_due_at is not null
    )
  );

alter table public.professional_verifications
  add constraint professional_verifications_automated_shape check (
    source <> 'elyra_automated_verification'
    or (actor_role = 'system' and actor_user_id is null
        and to_status in ('verified', 'rejected') and evidence_digest is not null)
  );

-- ---------------------------------------------------------------------------
-- 4. Executor confiavel: gravar evidencia (service_role)
-- ---------------------------------------------------------------------------

/*
  Grava um lote de evidencias da submissao corrente. `p_items` e um array de
  objetos com as colunas acima. Valida submissao contra o onboarding (evidencia
  de envio antigo e recusada: replay). Idempotencia: a evidencia e historico;
  o que decide e sempre a mais recente por fato dentro da submissao.
*/
create or replace function public.record_verification_evidence_for(
  p_professional_user_id uuid,
  p_submission integer,
  p_items jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  draft public.professional_onboarding%rowtype;
  item jsonb;
  written integer := 0;
begin
  if p_professional_user_id is null or p_submission is null
     or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 40 then
    raise exception 'invalid evidence batch' using errcode = '22023';
  end if;
  if not exists (select 1 from public.professional_profiles where user_id = p_professional_user_id) then
    raise exception 'verification target unavailable' using errcode = '42501';
  end if;
  if p_submission > 0 then
    select * into draft from public.professional_onboarding where user_id = p_professional_user_id;
    if not found or draft.submission_count <> p_submission then
      raise exception 'evidence replay' using errcode = '22023';
    end if;
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    insert into public.professional_verification_evidence (
      professional_user_id, submission, fact_type, source_type, provider, status, detail,
      assurance, value_digest, confidence, checked_at, expires_at, retention_until, policy_version
    ) values (
      p_professional_user_id, p_submission,
      item ->> 'fact_type', item ->> 'source_type', item ->> 'provider', item ->> 'status',
      nullif(item ->> 'detail', ''), nullif(item ->> 'assurance', ''),
      nullif(item ->> 'value_digest', ''), (item ->> 'confidence')::numeric,
      coalesce((item ->> 'checked_at')::timestamptz, statement_timestamp()),
      (item ->> 'expires_at')::timestamptz, (item ->> 'retention_until')::timestamptz,
      item ->> 'policy_version'
    );
    written := written + 1;
  end loop;
  return written;
end;
$$;

revoke all on function public.record_verification_evidence_for(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.record_verification_evidence_for(uuid, integer, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Decisao automatica (service_role) — o banco confere a prova de novo
-- ---------------------------------------------------------------------------

/*
  Fonte aceita por fato obrigatorio. Registro so por fonte oficial individual
  ou provider opcional configurado; identidade so com assurance >= documento
  conferido. `qa_fixture` e `demo_local` so com o interruptor local ligado.
*/
create or replace function public.verification_evidence_accepted(
  p_fact text,
  p_source text,
  p_assurance text
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_source in ('qa_fixture', 'demo_local') then
      coalesce((select accept_fixture_evidence from public.professional_verification_settings), false)
      and (p_fact <> 'identity_match'
           or p_assurance in ('identity_document_crosschecked', 'identity_strongly_verified'))
    when p_fact in ('professional_registry', 'registry_holder_match', 'registry_status') then
      p_source in ('official_registry', 'optional_provider')
    when p_fact = 'identity_match' then
      p_source in ('official_registry', 'optional_provider', 'local_evidence', 'human_review')
      and p_assurance in ('identity_document_crosschecked', 'identity_strongly_verified')
    when p_fact in ('auth_account', 'required_terms', 'registry_format') then
      p_source = 'local_evidence'
    else false
  end;
$$;

revoke all on function public.verification_evidence_accepted(text, text, text) from public, anon, authenticated;

create or replace function public.apply_automated_verification_for(
  p_professional_user_id uuid,
  p_submission integer,
  p_outcome text,
  p_policy_version text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  draft public.professional_onboarding%rowtype;
  current_status text;
  required text[] := array['auth_account', 'required_terms', 'registry_format', 'identity_match',
                           'professional_registry', 'registry_holder_match', 'registry_status'];
  fact text;
  latest public.professional_verification_evidence%rowtype;
  digest_source text := '';
  digest text;
  due_at timestamptz := statement_timestamp() + interval '180 days';
begin
  if p_outcome is null or p_outcome not in ('verified', 'rejected') then
    raise exception 'invalid automated outcome' using errcode = '22023';
  end if;
  if p_policy_version is null or p_policy_version !~ '^[a-z0-9_.-]{3,40}$' then
    raise exception 'invalid policy version' using errcode = '22023';
  end if;

  select * into draft from public.professional_onboarding
  where user_id = p_professional_user_id
  for update;
  if not found or p_submission is null or p_submission <> draft.submission_count
     or p_submission <= draft.precheck_submission then
    raise exception 'automated decision replay' using errcode = '22023';
  end if;

  select profile.verification_status into current_status
  from public.professional_profiles profile
  where profile.user_id = p_professional_user_id
  for update;
  if current_status is distinct from 'pending' then
    raise exception 'automated decision not applicable' using errcode = '22023';
  end if;

  -- Sinal de seguranca em qualquer fato da submissao: nunca decide sozinho.
  if exists (
    select 1 from public.professional_verification_evidence e
    where e.professional_user_id = p_professional_user_id and e.submission = p_submission
      and e.status in ('REPLAY', 'TAMPERED', 'DUPLICATE')
  ) then
    raise exception 'automated decision blocked by security signal' using errcode = '22023';
  end if;

  if p_outcome = 'verified' then
    foreach fact in array required loop
      -- Vale a evidencia mais recente do fato nesta submissao; o pior status
      -- empatado no mesmo instante vence (nunca um PASS mascara outro).
      select e.* into latest
      from public.professional_verification_evidence e
      where e.professional_user_id = p_professional_user_id and e.submission = p_submission
        and e.fact_type = fact
      order by e.checked_at desc, (e.status = 'PASS') asc
      limit 1;
      if latest.id is null
         or latest.status <> 'PASS'
         or latest.checked_at < statement_timestamp() - interval '24 hours'
         or (latest.expires_at is not null and latest.expires_at <= statement_timestamp())
         or not public.verification_evidence_accepted(latest.fact_type, latest.source_type, latest.assurance) then
        raise exception 'mandatory evidence not proven: %', fact using errcode = '22023';
      end if;
      digest_source := digest_source || latest.id::text || ':' || latest.status || ':'
                       || coalesce(latest.value_digest, '-') || ';';
      if latest.expires_at is not null and latest.expires_at < due_at then
        due_at := latest.expires_at;
      end if;
    end loop;
  else
    -- Recusa so por incompatibilidade provada: registro do MESMO titular,
    -- encontrado em fonte aceita, e inativo.
    select e.* into latest from public.professional_verification_evidence e
    where e.professional_user_id = p_professional_user_id and e.submission = p_submission
      and e.fact_type = 'registry_status'
    order by e.checked_at desc limit 1;
    if latest.id is null or latest.status <> 'FAIL' or latest.detail is distinct from 'registry_inactive'
       or not public.verification_evidence_accepted('registry_status', latest.source_type, latest.assurance) then
      raise exception 'rejection not proven' using errcode = '22023';
    end if;
    digest_source := latest.id::text || ':FAIL;';
    select e.* into latest from public.professional_verification_evidence e
    where e.professional_user_id = p_professional_user_id and e.submission = p_submission
      and e.fact_type = 'registry_holder_match'
    order by e.checked_at desc limit 1;
    if latest.id is null or latest.status <> 'PASS'
       or not public.verification_evidence_accepted('registry_holder_match', latest.source_type, latest.assurance) then
      raise exception 'rejection not proven' using errcode = '22023';
    end if;
    digest_source := digest_source || latest.id::text || ':PASS;';
  end if;

  digest := encode(extensions.digest(convert_to(digest_source, 'UTF8'), 'sha256'), 'hex');

  update public.professional_profiles
  set verification_status = p_outcome,
      verification_reviewed_at = case when p_outcome = 'verified' then statement_timestamp() else verification_reviewed_at end,
      verification_review_due_at = case when p_outcome = 'verified' then due_at else null end,
      verification_updated_at = statement_timestamp()
  where user_id = p_professional_user_id;

  insert into public.professional_verifications (
    professional_user_id, from_status, to_status, reason_code, source,
    evidence_digest, actor_user_id, actor_role, review_due_at, policy_version
  ) values (
    p_professional_user_id, 'pending', p_outcome,
    case when p_outcome = 'verified' then 'registry_active_confirmed' else 'registry_inactive' end,
    'elyra_automated_verification', digest, null, 'system',
    case when p_outcome = 'verified' then due_at else null end, p_policy_version
  );

  update public.professional_onboarding
  set precheck_submission = p_submission
  where user_id = p_professional_user_id;

  perform public.professional_verification_notify(p_professional_user_id);
  return p_outcome;
end;
$$;

revoke all on function public.apply_automated_verification_for(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.apply_automated_verification_for(uuid, integer, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Projecoes de leitura
-- ---------------------------------------------------------------------------

/*
  Dono: o que foi conferido, em que estado e de que TIPO de fonte. Sem digest,
  sem provider, sem detalhe tecnico. So a submissao mais recente.
*/
create or replace function public.list_my_verification_evidence()
returns table (fact_type text, status text, source_category text, checked_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (e.fact_type)
         e.fact_type, e.status,
         case e.source_type
           when 'official_registry' then 'official'
           when 'official_open_data' then 'official'
           when 'optional_provider' then 'external'
           when 'human_review' then 'human'
           when 'demo_local' then 'demo'
           when 'qa_fixture' then 'demo'
           else 'elyra'
         end,
         e.checked_at
  from public.professional_verification_evidence e
  where e.professional_user_id = auth.uid()
    and e.submission = coalesce((select o.submission_count from public.professional_onboarding o
                                 where o.user_id = auth.uid()), 0)
  order by e.fact_type, e.checked_at desc;
$$;

revoke all on function public.list_my_verification_evidence() from public, anon, service_role;
grant execute on function public.list_my_verification_evidence() to authenticated;

/* Reviewer ativo com aal2: evidencia completa de outra pessoa (nunca de si). */
create or replace function public.list_verification_evidence_for_review(p_professional_user_id uuid)
returns table (
  id uuid, submission integer, fact_type text, source_type text, provider text, status text,
  detail text, assurance text, confidence numeric, checked_at timestamptz, expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.professional_reviewer_is_active(auth.uid()) then
    raise exception 'reviewer required' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'reviewer mfa required' using errcode = '42501';
  end if;
  if p_professional_user_id is null or p_professional_user_id = auth.uid() then
    raise exception 'self review forbidden' using errcode = '42501';
  end if;
  return query
  select e.id, e.submission, e.fact_type, e.source_type, e.provider, e.status, e.detail,
         e.assurance, e.confidence, e.checked_at, e.expires_at
  from public.professional_verification_evidence e
  where e.professional_user_id = p_professional_user_id
  order by e.submission desc, e.checked_at desc
  limit 200;
end;
$$;

revoke all on function public.list_verification_evidence_for_review(uuid) from public, anon, service_role;
grant execute on function public.list_verification_evidence_for_review(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Snapshot local do cadastro e-MEC (dado aberto oficial)
-- ---------------------------------------------------------------------------

create table public.education_registry_snapshots (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('emec_open_data', 'qa_fixture')),
  -- Data de referencia publicada pelo MEC no arquivo importado.
  reference_date date not null,
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  row_count integer not null check (row_count >= 0),
  imported_at timestamptz not null default timezone('utc', now()),
  active boolean not null default false
);

create unique index education_registry_snapshots_one_active
  on public.education_registry_snapshots ((true)) where active;

create table public.education_registry_courses (
  snapshot_id uuid not null references public.education_registry_snapshots(id) on delete cascade,
  institution_code integer not null check (institution_code > 0),
  institution_name_normalized text not null check (char_length(institution_name_normalized) between 2 and 300),
  course_code integer not null check (course_code > 0),
  course_name_normalized text not null check (char_length(course_name_normalized) between 2 and 300),
  degree text,
  course_status text,
  primary key (snapshot_id, course_code)
);

create index education_registry_courses_institution_idx
  on public.education_registry_courses (snapshot_id, institution_name_normalized);

alter table public.education_registry_snapshots enable row level security;
alter table public.education_registry_snapshots force row level security;
alter table public.education_registry_courses enable row level security;
alter table public.education_registry_courses force row level security;
revoke all on table public.education_registry_snapshots from public, anon, authenticated;
revoke all on table public.education_registry_courses from public, anon, authenticated;
grant all on table public.education_registry_snapshots to service_role;
grant all on table public.education_registry_courses to service_role;

comment on table public.education_registry_courses is
  'Cursos do cadastro e-MEC (dado aberto oficial). Prova curso/IES/regularidade, NUNCA que uma pessoa concluiu o curso.';
