-- Stage 29 / F1-F3 — maquina de estado profissional, onboarding retomavel,
-- credenciais declaradas e pre-checagem automatica (Veltrix precheck).
--
-- Somente aditivo: vocabularios de check sao **ampliados** (superconjunto),
-- tabelas novas, funcoes novas e `create or replace` com a mesma assinatura.
-- Nenhuma linha existente muda de estado.
--
-- Invariante central (inalterada e reforcada): `verified` so nasce de reviewer
-- humano ativo com `aal2`, fonte oficial manual e digest de evidencia
-- (`professional_verifications_approval_shape`). A pre-checagem automatica so
-- pode manter na fila (manual hold) ou pedir correcao — nunca aprovar, nunca
-- rejeitar. Motivo: nao existe fonte oficial automatizavel do CFP (ver

-- ---------------------------------------------------------------------------
-- 1. Estado `needs_correction` (PENDING_CORRECTION) e vocabulario da trilha
-- ---------------------------------------------------------------------------

alter table public.professional_profiles
  drop constraint professional_profiles_verification_status_check;
alter table public.professional_profiles
  add constraint professional_profiles_verification_status_check check (
    verification_status in (
      'pending', 'under_review', 'verified', 'rejected', 'suspended', 'expired_review',
      'needs_correction'
    )
  );

alter table public.professional_verifications
  drop constraint professional_verifications_status_vocabulary;
alter table public.professional_verifications
  add constraint professional_verifications_status_vocabulary check (
    to_status in (
      'pending', 'under_review', 'verified', 'rejected', 'suspended', 'expired_review',
      'needs_correction'
    )
    and (
      from_status is null
      or from_status in (
        'pending', 'under_review', 'verified', 'rejected', 'suspended',
        'expired_review', 'unverified', 'needs_correction'
      )
    )
  );

alter table public.professional_verifications
  drop constraint professional_verifications_reason_code_check;
alter table public.professional_verifications
  add constraint professional_verifications_reason_code_check check (reason_code in (
    'legacy_migration',
    'credential_submitted',
    'credential_changed',
    'review_started',
    'review_due',
    'registry_active_confirmed',
    'registry_not_found',
    'registry_inactive',
    'registry_mismatch',
    'source_unavailable',
    'conduct_report',
    'validity_elapsed',
    -- F1-F3
    'correction_requested',
    'correction_submitted',
    'automated_precheck_manual_hold',
    'registry_format_invalid',
    'identity_unconfirmed',
    'information_insufficient',
    'name_mismatch',
    'document_unreadable'
  ));

alter table public.professional_verifications
  drop constraint professional_verifications_source_check;
alter table public.professional_verifications
  add constraint professional_verifications_source_check check (source in (
    'elyra_workflow',
    'cfp_cadastro_nacional_manual',
    'crp_regional_manual',
    'system',
    'elyra_precheck'
  ));

-- A pre-checagem e sempre `system` e nunca aprova nem rejeita. Redundante com
-- `approval_shape` para `verified`; explicito para `rejected`.
alter table public.professional_verifications
  add constraint professional_verifications_precheck_shape check (
    source <> 'elyra_precheck'
    or (actor_role = 'system' and to_status in ('pending', 'needs_correction'))
  );

-- ---------------------------------------------------------------------------
-- 2. Onboarding retomavel (ONBOARDING)
--
-- Rascunho do cadastro profissional. Nada aqui e publico nem concede acesso:
-- o perfil profissional so nasce no envio (`submit_professional_onboarding`).
-- Sem CPF, sem RG, sem endereco, sem documento: a identidade e a da conta
-- (uma pessoa, uma identidade Auth) e a confirmacao e declaratoria.
-- ---------------------------------------------------------------------------

create table public.professional_onboarding (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  current_step text not null default 'inicio',
  completed_steps text[] not null default '{}',
  identity_confirmed_at timestamptz,
  draft_council_region text,
  draft_registration_number text,
  draft_specialty text,
  -- Rascunho do perfil publico (atuacao + apresentacao). Privado; so vira
  -- `professional_public_profiles` no envio, com `listed = false` e todas as
  -- constraints daquela tabela. Nunca aparece na descoberta daqui.
  draft_public_profile jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  submission_count integer not null default 0,
  precheck_submission integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint professional_onboarding_step_check check (current_step in (
    'inicio', 'identidade', 'registro', 'formacao', 'experiencia',
    'certificacoes', 'atuacao', 'perfil-publico', 'revisao'
  )),
  constraint professional_onboarding_completed_check check (completed_steps <@ array[
    'inicio', 'identidade', 'registro', 'formacao', 'experiencia',
    'certificacoes', 'atuacao', 'perfil-publico', 'revisao'
  ]::text[] and cardinality(completed_steps) <= 9),
  constraint professional_onboarding_region_check check (
    draft_council_region is null or draft_council_region ~ '^(0[1-9]|[1-9][0-9])$'
  ),
  constraint professional_onboarding_registration_check check (
    draft_registration_number is null or char_length(btrim(draft_registration_number)) between 3 and 50
  ),
  constraint professional_onboarding_specialty_check check (
    draft_specialty is null or char_length(btrim(draft_specialty)) between 2 and 80
  ),
  constraint professional_onboarding_public_draft_check check (
    jsonb_typeof(draft_public_profile) = 'object' and pg_column_size(draft_public_profile) <= 4096
  ),
  constraint professional_onboarding_counters_check check (
    submission_count >= 0 and precheck_submission between 0 and submission_count
  )
);

comment on table public.professional_onboarding is
  'Rascunho retomavel do cadastro profissional. Sem documento, CPF ou endereco.';

alter table public.professional_onboarding enable row level security;
alter table public.professional_onboarding force row level security;
revoke all on table public.professional_onboarding from anon, authenticated, service_role;
grant select on table public.professional_onboarding to authenticated;
-- Contadores e `submitted_at` so mudam pelas RPCs.
grant insert (user_id, current_step, completed_steps, identity_confirmed_at,
              draft_council_region, draft_registration_number, draft_specialty,
              draft_public_profile)
  on table public.professional_onboarding to authenticated;
grant update (current_step, completed_steps, identity_confirmed_at,
              draft_council_region, draft_registration_number, draft_specialty,
              draft_public_profile)
  on table public.professional_onboarding to authenticated;

create policy professional_onboarding_select_own on public.professional_onboarding
  for select to authenticated using (user_id = (select auth.uid()));
create policy professional_onboarding_insert_own on public.professional_onboarding
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy professional_onboarding_update_own on public.professional_onboarding
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- O horario da confirmacao e do servidor: o cliente so diz "confirmo".
create or replace function public.professional_onboarding_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.identity_confirmed_at is not null then
      new.identity_confirmed_at := statement_timestamp();
    end if;
  else
    if new.identity_confirmed_at is not null and old.identity_confirmed_at is not null then
      new.identity_confirmed_at := old.identity_confirmed_at;
    elsif new.identity_confirmed_at is not null then
      new.identity_confirmed_at := statement_timestamp();
    end if;
  end if;
  new.draft_registration_number := nullif(btrim(new.draft_registration_number), '');
  new.draft_specialty := nullif(btrim(new.draft_specialty), '');
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger professional_onboarding_normalize
  before insert or update on public.professional_onboarding
  for each row execute function public.professional_onboarding_normalize();

-- ---------------------------------------------------------------------------
-- 3. Credenciais declaradas (formacao, experiencia, certificacao)
--
-- `declared` = o profissional afirmou. `verified` so por reviewer (F5). Editar
-- o conteudo de um item verificado o devolve a `declared`: verificacao vale
-- para o que foi conferido, nao para o que foi escrito depois.
-- ---------------------------------------------------------------------------

create table public.professional_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  kind text not null check (kind in ('education', 'experience', 'certification')),
  title text not null check (char_length(btrim(title)) between 2 and 120),
  institution text not null check (char_length(btrim(institution)) between 2 and 120),
  start_year smallint check (start_year between 1950 and 2100),
  end_year smallint check (end_year between 1950 and 2100),
  expires_on date,
  trust_state text not null default 'declared' check (trust_state in ('declared', 'verified')),
  verified_at timestamptz,
  evidence_digest text check (evidence_digest ~ '^[0-9a-f]{64}$'),
  verification_source text check (verification_source in ('issuer_manual', 'document_manual')),
  policy_version text,
  position smallint not null default 0 check (position between 0 and 99),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint professional_credentials_years_check check (
    start_year is null or end_year is null or end_year >= start_year
  ),
  constraint professional_credentials_trust_shape check (
    (trust_state = 'declared' and verified_at is null and evidence_digest is null
      and verification_source is null)
    or (trust_state = 'verified' and verified_at is not null and evidence_digest is not null
      and verification_source is not null and policy_version is not null)
  )
);

comment on table public.professional_credentials is
  'Formacao, experiencia e certificacoes do profissional. Guarda so digest de evidencia, nunca documento.';

create index professional_credentials_user_idx
  on public.professional_credentials (user_id, kind, position);

alter table public.professional_credentials enable row level security;
alter table public.professional_credentials force row level security;
revoke all on table public.professional_credentials from anon, authenticated, service_role;
grant select, delete on table public.professional_credentials to authenticated;
grant insert (user_id, kind, title, institution, start_year, end_year, expires_on, position)
  on table public.professional_credentials to authenticated;
grant update (title, institution, start_year, end_year, expires_on, position)
  on table public.professional_credentials to authenticated;

create policy professional_credentials_select_own on public.professional_credentials
  for select to authenticated using (user_id = (select auth.uid()));
create policy professional_credentials_insert_own on public.professional_credentials
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy professional_credentials_update_own on public.professional_credentials
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy professional_credentials_delete_own on public.professional_credentials
  for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.professional_credentials_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.professional_credentials credential
        where credential.user_id = new.user_id) >= 30 then
      raise exception 'credential limit reached' using errcode = '22023';
    end if;
    new.title := btrim(new.title);
    new.institution := btrim(new.institution);
    return new;
  end if;
  new.title := btrim(new.title);
  new.institution := btrim(new.institution);
  if old.trust_state = 'verified'
    and (new.title, new.institution, new.start_year, new.end_year, new.expires_on)
      is distinct from (old.title, old.institution, old.start_year, old.end_year, old.expires_on)
    -- Mudanca feita pela propria RPC de revisao (F5) nao se autoinvalida.
    and new.verified_at is not distinct from old.verified_at then
    new.trust_state := 'declared';
    new.verified_at := null;
    new.evidence_digest := null;
    new.verification_source := null;
    new.policy_version := null;
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger professional_credentials_guard
  before insert or update on public.professional_credentials
  for each row execute function public.professional_credentials_guard();

-- ---------------------------------------------------------------------------
-- 4. Notificacao de verificacao (reusa a infraestrutura 29-C)
--
-- Copy fechada no app; a linha so diz "ha uma atualizacao". O estado (aprovado,
-- recusado, correcao) fica atras da autenticacao — tela bloqueada nao conta.
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (
  kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice',
           'appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder',
           'session_ready', 'connection_requested', 'relationship_created',
           'professional_verification_update')
);
alter table public.notifications drop constraint notifications_event_key_check;
alter table public.notifications add constraint notifications_event_key_check check (
  event_key ~ '^(checkin_reminder|goal_reminder|system_notice):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or event_key ~ '^weekly_digest:[0-9]{4}-W[0-9]{2}$'
  or event_key ~ '^appointment_(requested|confirmed|cancelled|reminder):[0-9a-f-]{36}$'
  or event_key ~ '^session_ready:[0-9a-f-]{36}$'
  or event_key ~ '^(connection_requested|relationship_created):[0-9a-f-]{36}$'
  or event_key ~ '^professional_verification_update:[0-9a-f-]{36}$'
);

alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check check (
  kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice',
           'appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder',
           'session_ready', 'connection_requested', 'relationship_created',
           'professional_verification_update')
);

alter table public.email_deliveries drop constraint email_deliveries_kind_check;
alter table public.email_deliveries add constraint email_deliveries_kind_check check (
  kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice',
           'appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder',
           'session_ready', 'connection_requested', 'relationship_created',
           'professional_verification_update')
);
alter table public.email_deliveries drop constraint email_deliveries_event_key_check;
alter table public.email_deliveries add constraint email_deliveries_event_key_check check (
  event_key ~ '^(checkin_reminder|goal_reminder|system_notice):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or event_key ~ '^weekly_digest:[0-9]{4}-W[0-9]{2}$'
  or event_key ~ '^appointment_(requested|confirmed|cancelled|reminder):[0-9a-f-]{36}$'
  or event_key ~ '^session_ready:[0-9a-f-]{36}$'
  or event_key ~ '^(connection_requested|relationship_created):[0-9a-f-]{36}$'
  or event_key ~ '^professional_verification_update:[0-9a-f-]{36}$'
);

create or replace function public.seed_notification_preferences(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  legacy public.user_preferences%rowtype;
begin
  select * into legacy
  from public.user_preferences
  where user_id = p_user_id;

  insert into public.notification_preferences (user_id, kind, channel, enabled)
  values
    (p_user_id, 'checkin_reminder', 'in_app', coalesce(legacy.checkin_reminder, true)),
    (p_user_id, 'goal_reminder',    'in_app', coalesce(legacy.goal_reminder, true)),
    (p_user_id, 'weekly_digest',    'in_app', false),
    (p_user_id, 'system_notice',    'in_app', true),
    (p_user_id, 'checkin_reminder', 'web_push', false),
    (p_user_id, 'goal_reminder',    'web_push', false),
    (p_user_id, 'weekly_digest',    'web_push', false),
    (p_user_id, 'system_notice',    'web_push', false),
    (p_user_id, 'checkin_reminder', 'email', false),
    (p_user_id, 'goal_reminder',    'email', false),
    (p_user_id, 'weekly_digest',    'email', false),
    (p_user_id, 'system_notice',    'email', false),
    (p_user_id, 'appointment_requested', 'in_app', true),
    (p_user_id, 'appointment_confirmed', 'in_app', true),
    (p_user_id, 'appointment_cancelled', 'in_app', true),
    (p_user_id, 'appointment_reminder',  'in_app', true),
    (p_user_id, 'appointment_requested', 'web_push', false),
    (p_user_id, 'appointment_confirmed', 'web_push', false),
    (p_user_id, 'appointment_cancelled', 'web_push', false),
    (p_user_id, 'appointment_reminder',  'web_push', false),
    (p_user_id, 'appointment_requested', 'email', false),
    (p_user_id, 'appointment_confirmed', 'email', false),
    (p_user_id, 'appointment_cancelled', 'email', false),
    (p_user_id, 'appointment_reminder',  'email', false),
    (p_user_id, 'session_ready', 'in_app', true),
    (p_user_id, 'session_ready', 'web_push', false),
    (p_user_id, 'session_ready', 'email', false),
    (p_user_id, 'connection_requested', 'in_app', true),
    (p_user_id, 'connection_requested', 'web_push', false),
    (p_user_id, 'connection_requested', 'email', false),
    (p_user_id, 'relationship_created', 'in_app', true),
    (p_user_id, 'relationship_created', 'web_push', false),
    (p_user_id, 'relationship_created', 'email', false),
    (p_user_id, 'professional_verification_update', 'in_app', true),
    (p_user_id, 'professional_verification_update', 'web_push', false),
    (p_user_id, 'professional_verification_update', 'email', false)
  on conflict (user_id, kind, channel) do nothing;
end;
$$;

select public.seed_notification_preferences(profile.user_id) from public.profiles profile;

create or replace function public.professional_verification_notify(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.notification_channel_delivers(p_user_id, 'professional_verification_update', 'in_app') then
    insert into public.notifications (user_id, kind, event_key)
    values (p_user_id, 'professional_verification_update',
            'professional_verification_update:' || gen_random_uuid()::text)
    on conflict (user_id, event_key) do nothing;
  end if;
end;
$$;

revoke all on function public.professional_verification_notify(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Envio do onboarding
-- ---------------------------------------------------------------------------

create or replace function public.submit_professional_onboarding()
returns table (verification_status text, submission integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  draft public.professional_onboarding%rowtype;
  before_status text;
  after_status text;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select * into draft from public.professional_onboarding
  where user_id = actor_id
  for update;
  if not found then
    raise exception 'onboarding required' using errcode = '22023';
  end if;
  if draft.identity_confirmed_at is null then
    raise exception 'identity confirmation required' using errcode = '22023';
  end if;
  if draft.draft_council_region is null
    or draft.draft_registration_number is null
    or draft.draft_specialty is null then
    raise exception 'registry required' using errcode = '22023';
  end if;

  select public.professional_effective_verification_status(
           profile.verification_status, profile.verification_review_due_at)
    into before_status
  from public.professional_profiles profile
  where profile.user_id = actor_id
  for update;

  if before_status = 'verified' then
    -- Profissional verificado edita o registro em /pro/perfil, nao reenvia cadastro.
    raise exception 'already verified' using errcode = '22023';
  end if;
  if before_status = 'suspended' then
    raise exception 'credential locked' using errcode = '42501';
  end if;

  -- Cria o perfil (`pending`) ou, se a credencial mudou, reinicia a conferencia.
  perform public.save_professional_credential(
    draft.draft_council_region, draft.draft_registration_number, draft.draft_specialty
  );

  select profile.verification_status into after_status
  from public.professional_profiles profile
  where profile.user_id = actor_id
  for update;

  if after_status = 'rejected' then
    -- Mesma credencial ja recusada na fonte oficial: reenviar igual e ruido.
    raise exception 'credential unchanged' using errcode = '22023';
  end if;

  if after_status = 'needs_correction' then
    update public.professional_profiles
    set verification_status = 'pending',
        verification_updated_at = statement_timestamp()
    where user_id = actor_id;
    insert into public.professional_verifications (
      professional_user_id, from_status, to_status, reason_code, source,
      actor_user_id, actor_role
    ) values (
      actor_id, 'needs_correction', 'pending', 'correction_submitted', 'elyra_workflow',
      actor_id, 'professional'
    );
    after_status := 'pending';
  end if;

  update public.professional_onboarding
  set submitted_at = statement_timestamp(),
      submission_count = submission_count + 1,
      current_step = 'revisao',
      updated_at = statement_timestamp()
  where user_id = actor_id
  returning submission_count into draft.submission_count;

  perform public.professional_verification_notify(actor_id);

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, 'professional_onboarding.submitted', 'professional_profile', actor_id,
    'success', gen_random_uuid()
  );

  return query select after_status, draft.submission_count;
end;
$$;

revoke all on function public.submit_professional_onboarding() from public, anon, service_role;
grant execute on function public.submit_professional_onboarding() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Pre-checagem automatica (Veltrix precheck) — resultado restrito
--
-- A decisao e calculada no servidor da Elyra (orquestrador TypeScript,
-- testado pela matriz §46). O banco aceita **so** dois desfechos, uma vez por
-- envio: manter na fila para revisao humana, ou pedir correcao. Um cliente que
-- chame esta RPC direto so consegue atrasar o proprio cadastro.
-- ---------------------------------------------------------------------------

create or replace function public.record_professional_precheck(
  p_submission integer,
  p_outcome text,
  p_reason_code text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  draft public.professional_onboarding%rowtype;
  current_status text;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select * into draft from public.professional_onboarding
  where user_id = actor_id
  for update;
  if not found or p_submission is null or p_submission <> draft.submission_count
    or p_submission <= draft.precheck_submission then
    -- Replay ou envio antigo: nada muda.
    raise exception 'precheck replay' using errcode = '22023';
  end if;

  select profile.verification_status into current_status
  from public.professional_profiles profile
  where profile.user_id = actor_id
  for update;
  if current_status is distinct from 'pending' then
    raise exception 'precheck not applicable' using errcode = '22023';
  end if;

  if p_outcome = 'manual_hold' and p_reason_code = 'automated_precheck_manual_hold' then
    insert into public.professional_verifications (
      professional_user_id, from_status, to_status, reason_code, source, actor_user_id, actor_role
    ) values (
      actor_id, 'pending', 'pending', p_reason_code, 'elyra_precheck', null, 'system'
    );
  elsif p_outcome = 'needs_correction' and p_reason_code in (
    'registry_format_invalid', 'identity_unconfirmed', 'information_insufficient',
    'name_mismatch', 'document_unreadable', 'registry_mismatch'
  ) then
    update public.professional_profiles
    set verification_status = 'needs_correction',
        verification_updated_at = statement_timestamp()
    where user_id = actor_id;
    insert into public.professional_verifications (
      professional_user_id, from_status, to_status, reason_code, source, actor_user_id, actor_role
    ) values (
      actor_id, 'pending', 'needs_correction', p_reason_code, 'elyra_precheck', null, 'system'
    );
    perform public.professional_verification_notify(actor_id);
    current_status := 'needs_correction';
  else
    raise exception 'invalid precheck outcome' using errcode = '22023';
  end if;

  update public.professional_onboarding
  set precheck_submission = p_submission
  where user_id = actor_id;

  return current_status;
end;
$$;

revoke all on function public.record_professional_precheck(integer, text, text) from public, anon, service_role;
grant execute on function public.record_professional_precheck(integer, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Revisao humana: + pedido de correcao, + aviso ao profissional
-- ---------------------------------------------------------------------------

create or replace function public.review_professional_verification(
  p_professional_user_id uuid,
  p_to_status text,
  p_reason_code text,
  p_source text,
  p_evidence_digest text default null,
  p_valid_days integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target public.professional_profiles%rowtype;
  effective_status text;
  event_id uuid;
  due_at timestamptz;
  allowed boolean;
begin
  if actor_id is null or not public.professional_reviewer_is_active(actor_id) then
    raise exception 'reviewer required' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'reviewer mfa required' using errcode = '42501';
  end if;
  if p_professional_user_id is null or p_professional_user_id = actor_id then
    raise exception 'self review forbidden' using errcode = '42501';
  end if;
  if p_source not in ('cfp_cadastro_nacional_manual', 'crp_regional_manual', 'elyra_workflow') then
    raise exception 'invalid verification source' using errcode = '22023';
  end if;
  if p_evidence_digest is not null and p_evidence_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid evidence digest' using errcode = '22023';
  end if;

  select * into target from public.professional_profiles
  where user_id = p_professional_user_id
  for update;
  if not found or target.council_region is null then
    raise exception 'verification target unavailable' using errcode = '42501';
  end if;

  effective_status := public.professional_effective_verification_status(
    target.verification_status, target.verification_review_due_at
  );

  allowed := case
    when p_to_status = 'under_review' then
      (effective_status in ('pending', 'expired_review', 'suspended') and p_reason_code = 'review_started')
      or (effective_status = 'verified' and p_reason_code = 'review_due')
    when p_to_status = 'verified' then
      effective_status = 'under_review'
      and p_reason_code = 'registry_active_confirmed'
      and p_source in ('cfp_cadastro_nacional_manual', 'crp_regional_manual')
      and p_evidence_digest is not null
    when p_to_status = 'rejected' then
      effective_status = 'under_review'
      and p_reason_code in ('registry_not_found', 'registry_inactive', 'registry_mismatch')
    when p_to_status = 'needs_correction' then
      -- Ambiguidade corrigivel volta ao profissional; nunca vira recusa.
      effective_status = 'under_review'
      and p_reason_code in ('correction_requested', 'name_mismatch', 'information_insufficient',
                            'document_unreadable', 'registry_format_invalid', 'registry_mismatch')
    when p_to_status = 'pending' then
      effective_status = 'under_review' and p_reason_code = 'source_unavailable'
    when p_to_status = 'suspended' then
      effective_status = 'verified'
      and p_reason_code in ('registry_inactive', 'conduct_report')
    else false
  end;

  if not coalesce(allowed, false) then
    raise exception 'verification transition not allowed' using errcode = '22023';
  end if;

  if p_to_status = 'verified' then
    if p_valid_days is null or p_valid_days not between 30 and 365 then
      raise exception 'invalid verification validity' using errcode = '22023';
    end if;
    due_at := statement_timestamp() + make_interval(days => p_valid_days);
  end if;

  update public.professional_profiles
  set verification_status = p_to_status,
      verification_reviewed_at = case when p_to_status = 'verified'
                                      then statement_timestamp()
                                      else verification_reviewed_at end,
      verification_review_due_at = case when p_to_status = 'verified' then due_at
                                        else null end,
      verification_updated_at = statement_timestamp()
  where user_id = p_professional_user_id;

  insert into public.professional_verifications (
    professional_user_id, from_status, to_status, reason_code, source,
    evidence_digest, actor_user_id, actor_role, review_due_at
  ) values (
    p_professional_user_id, effective_status, p_to_status, p_reason_code, p_source,
    p_evidence_digest, actor_id, 'reviewer', due_at
  ) returning id into event_id;

  if p_to_status in ('verified', 'rejected', 'needs_correction', 'suspended') then
    perform public.professional_verification_notify(p_professional_user_id);
  end if;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, 'professional_verification.' || p_to_status, 'professional_profile',
    p_professional_user_id, 'success', gen_random_uuid()
  );
  return event_id;
end;
$$;

revoke all on function public.review_professional_verification(uuid, text, text, text, text, integer) from public;
grant execute on function public.review_professional_verification(uuid, text, text, text, text, integer) to authenticated;
