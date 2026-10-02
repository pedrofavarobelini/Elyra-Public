-- Stage 29 / PRO-1 - identidade profissional e verificacao.
--
-- **O defeito que este gate fecha (G-01).** `verification_status` existia desde
-- a Stage 10, com catalogo fechado e sem escrita pelo cliente - mas os dois
-- helpers de acesso nunca olhavam para ele. Um profissional `unverified`, com
-- conexao aceita e grant, lia o dado da pessoa. A verificacao era um rotulo, nao
-- um portao.
--
-- **O que muda.**
--   1. vocabulario de seis estados; o legado migra fail-closed;
--   2. credencial (conselho, regiao, registro normalizado) no proprio perfil;
--   3. historico append-only de decisoes em `professional_verifications`;
--   4. reviewer com privilegio minimo, provisionado so pelo owner, exigindo aal2;
--   5. os helpers de acesso exigem verificacao **vigente**.
--
-- **Por que nao existe integracao automatica.** O CFP publica o Cadastro
-- Nacional como portal de consulta, sem API oficial documentada nem licenca de
-- uso automatizado (pesquisa de 24/09/2026, Stage-29/Context). O que o reviewer
-- registra e o **fato consultado** - fonte, motivo codificado, instante e um
-- digest opcional do que ele viu -, nunca documento, CPF ou texto livre.
--
-- Migration **aditiva**: nenhuma tabela ou coluna e removida. A unica mudanca de
-- valor e o remapeamento do status legado, e o valor anterior fica gravado no
-- evento `legacy_migration`.

-- ---------------------------------------------------------------------------
-- 1. Credencial e estado no perfil
-- ---------------------------------------------------------------------------

alter table public.professional_profiles
  drop constraint if exists professional_profiles_verification_status_check;

alter table public.professional_profiles
  add column if not exists council text not null default 'CRP',
  add column if not exists council_region text,
  add column if not exists registration_normalized text
    generated always as (
      regexp_replace(upper(registration_number), '[^0-9A-Z]', '', 'g')
    ) stored,
  add column if not exists verification_reviewed_at timestamptz,
  add column if not exists verification_review_due_at timestamptz,
  add column if not exists verification_updated_at timestamptz not null
    default timezone('utc', now());

alter table public.professional_profiles
  add constraint professional_profiles_council_check
    check (council in ('CRP')),
  add constraint professional_profiles_council_region_check
    check (council_region is null or council_region ~ '^(0[1-9]|[1-9][0-9])$');

comment on column public.professional_profiles.council_region is
  'Regiao do conselho (ex.: 06 para CRP-06). Formato apenas; a existencia e conferida pelo reviewer.';
comment on column public.professional_profiles.verification_review_due_at is
  'Fim da validade da verificacao. VERIFIED vencido vale como EXPIRED_REVIEW na leitura.';

-- ---------------------------------------------------------------------------
-- 2. Historico append-only
-- ---------------------------------------------------------------------------

create table public.professional_verifications (
  id uuid primary key default gen_random_uuid(),
  professional_user_id uuid not null
    references public.professional_profiles(user_id) on delete cascade,
  from_status text,
  to_status text not null,
  reason_code text not null check (reason_code in (
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
    'validity_elapsed'
  )),
  source text not null check (source in (
    'elyra_workflow',
    'cfp_cadastro_nacional_manual',
    'crp_regional_manual',
    'system'
  )),
  -- Digest (sha256 hex) do que o reviewer consultou, quando houver. Nunca o
  -- documento, nunca o CPF, nunca texto livre.
  evidence_digest text check (evidence_digest ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid references public.profiles(user_id) on delete set null,
  actor_role text not null check (actor_role in ('professional', 'reviewer', 'system')),
  review_due_at timestamptz,
  policy_version text not null default 'stage29.pro1.v1',
  correlation_id uuid not null default gen_random_uuid(),
  occurred_at timestamptz not null default timezone('utc', now()),
  constraint professional_verifications_status_vocabulary check (
    to_status in ('pending', 'under_review', 'verified', 'rejected', 'suspended', 'expired_review')
    and (
      from_status is null
      or from_status in (
        'pending', 'under_review', 'verified', 'rejected', 'suspended',
        'expired_review', 'unverified'
      )
    )
  ),
  constraint professional_verifications_approval_shape check (
    to_status <> 'verified'
    or (
      actor_role = 'reviewer'
      and source in ('cfp_cadastro_nacional_manual', 'crp_regional_manual')
      and evidence_digest is not null
      and review_due_at is not null
    )
  )
);

comment on table public.professional_verifications is
  'Decisoes de verificacao profissional. Append-only; sem documento, CPF ou texto livre.';

create index professional_verifications_professional_time_idx
  on public.professional_verifications (professional_user_id, occurred_at desc);

alter table public.professional_verifications enable row level security;
alter table public.professional_verifications force row level security;
revoke all on table public.professional_verifications from anon, authenticated, service_role;
-- Sem policy e sem grant: leitura e escrita so pelas RPCs abaixo.

-- ---------------------------------------------------------------------------
-- 3. Reviewer
-- ---------------------------------------------------------------------------

create table public.professional_reviewers (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  active boolean not null default true,
  granted_at timestamptz not null default timezone('utc', now()),
  granted_by text not null check (char_length(btrim(granted_by)) between 3 and 80),
  revoked_at timestamptz,
  constraint professional_reviewers_active_shape check (
    (active and revoked_at is null) or (not active and revoked_at is not null)
  )
);

comment on table public.professional_reviewers is
  'Papel administrativo minimo. Provisionado somente por SQL do owner; nenhuma RPC concede este papel.';

alter table public.professional_reviewers enable row level security;
alter table public.professional_reviewers force row level security;
revoke all on table public.professional_reviewers from anon, authenticated, service_role;
grant select on table public.professional_reviewers to authenticated;

create policy professional_reviewers_select_own
on public.professional_reviewers for select to authenticated
using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 4. Migracao do legado, fail-closed
--
-- `unverified` nunca teve revisao: vira `pending`. `verified` legado nunca teve
-- proveniencia (nao existia workflow) e por isso nao pode continuar liberando
-- acesso: vira `expired_review`, que exige nova revisao. O valor antigo fica no
-- evento.
-- ---------------------------------------------------------------------------

insert into public.professional_verifications (
  professional_user_id, from_status, to_status, reason_code, source, actor_role
)
select
  user_id,
  verification_status,
  case verification_status when 'verified' then 'expired_review' else 'pending' end,
  'legacy_migration',
  'system',
  'system'
from public.professional_profiles;

update public.professional_profiles
set verification_status =
      case verification_status when 'verified' then 'expired_review' else 'pending' end,
    verification_updated_at = timezone('utc', now());

alter table public.professional_profiles
  alter column verification_status set default 'pending';

-- O nome historico do check e preservado: o pgTAP da Stage 10 afirma que o
-- catalogo e fechado, e continua certo.
alter table public.professional_profiles
  add constraint professional_profiles_verification_status_check check (
    verification_status in (
      'pending', 'under_review', 'verified', 'rejected', 'suspended', 'expired_review'
    )
  );

alter table public.professional_profiles
  add constraint professional_profiles_verified_shape check (
    verification_status <> 'verified'
    or (
      verification_reviewed_at is not null
      and verification_review_due_at is not null
      and verification_review_due_at > verification_reviewed_at
      and council_region is not null
    )
  );

-- Uma credencial pertence a uma unica conta. Parcial: o legado sem regiao nao
-- colide entre si, e so vira elegivel depois de declarar a regiao.
create unique index professional_profiles_credential_unique
  on public.professional_profiles (council, council_region, registration_normalized)
  where council_region is not null;

create index professional_profiles_verification_queue_idx
  on public.professional_profiles (verification_status, verification_updated_at);

-- ---------------------------------------------------------------------------
-- 5. Verificacao vigente
--
-- Sem EXECUTE para ninguem alem do dono: chamada apenas dentro de funcoes
-- `security definer`. Concede-la a `authenticated` criaria um oraculo "este
-- UUID e profissional verificado?".
-- ---------------------------------------------------------------------------

create or replace function public.professional_verification_is_current(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1 from public.professional_profiles profile
    where profile.user_id = p_user_id
      and profile.verification_status = 'verified'
      and profile.verification_review_due_at > statement_timestamp()
  ), false);
$$;

revoke all on function public.professional_verification_is_current(uuid) from public, anon, authenticated, service_role;

-- Estado efetivo: `verified` vencido e `expired_review` na leitura, antes de
-- qualquer job materializar.
create or replace function public.professional_effective_verification_status(
  p_status text,
  p_review_due_at timestamptz
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_status = 'verified'
      and (p_review_due_at is null or p_review_due_at <= statement_timestamp())
      then 'expired_review'
    else p_status
  end;
$$;

revoke all on function public.professional_effective_verification_status(text, timestamptz) from public;
grant execute on function public.professional_effective_verification_status(text, timestamptz)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Credencial declarada pelo profissional
-- ---------------------------------------------------------------------------

create or replace function public.save_professional_credential(
  p_council_region text,
  p_registration_number text,
  p_specialty text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  current_profile public.professional_profiles%rowtype;
  new_region text := btrim(coalesce(p_council_region, ''));
  new_registration text := btrim(coalesce(p_registration_number, ''));
  new_specialty text := btrim(coalesce(p_specialty, ''));
  new_normalized text;
  credential_changed boolean;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if new_region !~ '^(0[1-9]|[1-9][0-9])$'
    or char_length(new_registration) not between 3 and 50
    or char_length(new_specialty) not between 2 and 80 then
    raise exception 'invalid professional profile' using errcode = '22023';
  end if;
  new_normalized := regexp_replace(upper(new_registration), '[^0-9A-Z]', '', 'g');
  if char_length(new_normalized) < 3 then
    raise exception 'invalid professional profile' using errcode = '22023';
  end if;

  select * into current_profile from public.professional_profiles
  where user_id = actor_id
  for update;

  if not found then
    begin
      insert into public.professional_profiles (
        user_id, council, council_region, registration_number, specialty,
        verification_status, verification_updated_at
      ) values (
        actor_id, 'CRP', new_region, new_registration, new_specialty,
        'pending', statement_timestamp()
      );
    exception when unique_violation then
      raise exception 'credential unavailable' using errcode = '23505';
    end;
    insert into public.professional_verifications (
      professional_user_id, from_status, to_status, reason_code, source,
      actor_user_id, actor_role
    ) values (
      actor_id, null, 'pending', 'credential_submitted', 'elyra_workflow',
      actor_id, 'professional'
    );
  else
    credential_changed :=
      current_profile.council_region is distinct from new_region
      or current_profile.registration_normalized is distinct from new_normalized;

    if credential_changed and current_profile.verification_status = 'suspended' then
      -- Editar a credencial nao pode ser o caminho para sair da suspensao.
      raise exception 'credential locked' using errcode = '42501';
    end if;

    begin
      update public.professional_profiles
      set council_region = new_region,
          registration_number = new_registration,
          specialty = new_specialty,
          verification_status = case when credential_changed then 'pending'
                                     else verification_status end,
          verification_reviewed_at = case when credential_changed then null
                                          else verification_reviewed_at end,
          verification_review_due_at = case when credential_changed then null
                                            else verification_review_due_at end,
          verification_updated_at = case when credential_changed then statement_timestamp()
                                         else verification_updated_at end
      where user_id = actor_id;
    exception when unique_violation then
      raise exception 'credential unavailable' using errcode = '23505';
    end;

    if credential_changed then
      insert into public.professional_verifications (
        professional_user_id, from_status, to_status, reason_code, source,
        actor_user_id, actor_role
      ) values (
        actor_id, current_profile.verification_status, 'pending',
        'credential_changed', 'elyra_workflow', actor_id, 'professional'
      );
    end if;
  end if;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, 'professional_profile.saved', 'professional_profile', actor_id,
    'success', gen_random_uuid()
  );
  return actor_id;
end;
$$;

-- A assinatura historica continua existindo e agora nunca grava `unverified`
-- (estado que deixou de existir). Sem regiao declarada o perfil fica
-- `pending` e inelegivel para revisao - fail-closed.
create or replace function public.upsert_professional_profile(
  p_registration_number text,
  p_specialty text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  existing_region text;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select council_region into existing_region
  from public.professional_profiles where user_id = actor_id;
  if existing_region is not null then
    return public.save_professional_credential(
      existing_region, p_registration_number, p_specialty
    );
  end if;
  if char_length(btrim(coalesce(p_registration_number, ''))) not between 3 and 50
    or char_length(btrim(coalesce(p_specialty, ''))) not between 2 and 80 then
    raise exception 'invalid professional profile' using errcode = '22023';
  end if;

  insert into public.professional_profiles (
    user_id, registration_number, specialty, verification_status
  ) values (
    actor_id, btrim(p_registration_number), btrim(p_specialty), 'pending'
  )
  on conflict (user_id) do update set
    registration_number = excluded.registration_number,
    specialty = excluded.specialty;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, 'professional_profile.saved', 'professional_profile', actor_id,
    'success', gen_random_uuid()
  );
  return actor_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Reviewer: fila e decisao
-- ---------------------------------------------------------------------------

create or replace function public.professional_reviewer_is_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1 from public.professional_reviewers reviewer
    where reviewer.user_id = p_user_id and reviewer.active
  ), false);
$$;

revoke all on function public.professional_reviewer_is_active(uuid) from public, anon, authenticated, service_role;

create or replace function public.list_professional_verification_queue()
returns table (
  professional_user_id uuid,
  council text,
  council_region text,
  registration_number text,
  specialty text,
  verification_status text,
  verification_updated_at timestamptz,
  verification_review_due_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not public.professional_reviewer_is_active(actor_id) then
    raise exception 'reviewer required' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'reviewer mfa required' using errcode = '42501';
  end if;

  -- Somente o necessario para consultar a fonte oficial. Nenhum dado pessoal
  -- de titular, nenhum contato.
  return query
  select profile.user_id, profile.council, profile.council_region,
         profile.registration_number, profile.specialty,
         public.professional_effective_verification_status(
           profile.verification_status, profile.verification_review_due_at
         ),
         profile.verification_updated_at, profile.verification_review_due_at
  from public.professional_profiles profile
  where profile.user_id <> actor_id
    and profile.council_region is not null
    and (
      profile.verification_status in ('pending', 'under_review', 'expired_review')
      or (profile.verification_status = 'verified'
          and profile.verification_review_due_at <= statement_timestamp() + interval '30 days')
    )
  order by profile.verification_updated_at asc
  limit 200;
end;
$$;

create or replace function public.review_professional_verification(
  p_professional_user_id uuid,
  p_to_status text,
  p_reason_code text,
  p_source text,
  -- `default null` nao e conveniencia: sem ele o tipo gerado exigiria digest e
  -- validade em decisoes que nao os tem (abrir revisao, suspender).
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
    -- Ninguem revisa a si mesmo, nem com dois papeis na mesma conta.
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
    when p_to_status = 'pending' then
      -- Falha de fonte externa devolve para a fila. Nunca aprova.
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

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, 'professional_verification.' || p_to_status, 'professional_profile',
    p_professional_user_id, 'success', gen_random_uuid()
  );
  return event_id;
end;
$$;

-- O proprio historico, sem o id do reviewer nem o digest: fatos da decisao,
-- nao dados de quem decidiu.
create or replace function public.list_my_professional_verification_events()
returns table (
  id uuid,
  from_status text,
  to_status text,
  reason_code text,
  source text,
  actor_role text,
  review_due_at timestamptz,
  occurred_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select event.id, event.from_status, event.to_status, event.reason_code,
         event.source, event.actor_role, event.review_due_at, event.occurred_at
  from public.professional_verifications event
  where event.professional_user_id = auth.uid()
  order by event.occurred_at desc, event.id
  limit 100;
$$;

-- Job operacional: materializa `verified` vencido. A negacao nao depende dele
-- (o helper ja compara a data); ele so deixa o estado gravado coerente.
create or replace function public.expire_professional_verifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  with expired as (
    update public.professional_profiles
    set verification_status = 'expired_review',
        verification_review_due_at = null,
        verification_updated_at = statement_timestamp()
    where verification_status = 'verified'
      and verification_review_due_at <= statement_timestamp()
    returning user_id
  ), events as (
    insert into public.professional_verifications (
      professional_user_id, from_status, to_status, reason_code, source, actor_role
    )
    select user_id, 'verified', 'expired_review', 'validity_elapsed', 'system', 'system'
    from expired
    returning 1
  )
  select count(*) into affected from events;
  return affected;
end;
$$;

revoke all on function public.save_professional_credential(text, text, text) from public;
revoke all on function public.list_professional_verification_queue() from public;
revoke all on function public.review_professional_verification(uuid, text, text, text, text, integer) from public;
revoke all on function public.list_my_professional_verification_events() from public;
revoke all on function public.expire_professional_verifications() from public, anon, authenticated;

grant execute on function public.save_professional_credential(text, text, text) to authenticated;
grant execute on function public.list_professional_verification_queue() to authenticated;
grant execute on function public.review_professional_verification(uuid, text, text, text, text, integer) to authenticated;
grant execute on function public.list_my_professional_verification_events() to authenticated;
grant execute on function public.expire_professional_verifications() to service_role;

-- ---------------------------------------------------------------------------
-- 8. Portao de verificacao nos helpers de acesso (fecha G-01)
--
-- Mesma assinatura, mesmo corpo, uma condicao a mais. Todas as 25 policies de
-- leitura profissional passam por estes dois helpers, entao a regra nova vale
-- para todo dominio sem reescrever policy por policy.
-- ---------------------------------------------------------------------------

create or replace function public.professional_access_allowed(
  p_client_user_id uuid,
  p_scope text,
  p_journal_entry_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.professional_verification_is_current(auth.uid())
    and exists (
      select 1
      from public.professional_connections connection
      join public.sharing_permissions permission
        on permission.connection_id = connection.id
      where connection.client_user_id = p_client_user_id
        and connection.professional_user_id = auth.uid()
        and connection.status = 'accepted'
        and connection.revoked_at is null
        and permission.scope = p_scope
        and permission.status = 'granted'
        and permission.revoked_at is null
        and (permission.expires_at is null or permission.expires_at > statement_timestamp())
        and (
          (p_scope = 'journal_entry' and permission.journal_entry_id = p_journal_entry_id)
          or (p_scope <> 'journal_entry' and permission.journal_entry_id is null)
        )
    ), false);
$$;

create or replace function public.professional_access_allowed_on(
  p_client_user_id uuid,
  p_scope text,
  p_from date,
  p_to date,
  p_journal_entry_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.professional_verification_is_current(auth.uid())
    and exists (
      select 1
      from public.professional_connections connection
      join public.sharing_permissions permission
        on permission.connection_id = connection.id
      where connection.client_user_id = p_client_user_id
        and connection.professional_user_id = auth.uid()
        and connection.status = 'accepted'
        and connection.revoked_at is null
        and permission.scope = p_scope
        and permission.status = 'granted'
        and permission.revoked_at is null
        and (permission.expires_at is null or permission.expires_at > statement_timestamp())
        and (
          (p_scope = 'journal_entry' and permission.journal_entry_id = p_journal_entry_id)
          or (p_scope <> 'journal_entry' and permission.journal_entry_id is null)
        )
        and (
          permission.data_from is null
          or (p_from is not null and p_from >= permission.data_from)
        )
        and (
          permission.data_to is null
          or (p_to is not null and p_to <= permission.data_to)
        )
    ), false);
$$;

-- O aceite do fluxo legado passa a exigir profissional verificado: um perfil
-- recem-criado nao acumula vinculos ativos antes da revisao.
create or replace function public.respond_professional_invitation(
  p_connection_id uuid,
  p_accept boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  connection public.professional_connections%rowtype;
begin
  select * into connection from public.professional_connections
  where id = p_connection_id and professional_user_id = actor_id
  for update;
  if not found or connection.status <> 'pending' then
    raise exception 'pending invitation unavailable' using errcode = '42501';
  end if;
  if p_accept and not public.professional_verification_is_current(actor_id) then
    raise exception 'verified professional required' using errcode = '42501';
  end if;

  update public.professional_connections
  set status = case when p_accept then 'accepted' else 'revoked' end,
      accepted_at = case when p_accept then statement_timestamp() else null end,
      revoked_at = case when p_accept then null else statement_timestamp() end
  where id = p_connection_id;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id,
    case when p_accept then 'professional_connection.accepted'
         else 'professional_connection.declined' end,
    'professional_connection', p_connection_id, 'success', gen_random_uuid()
  );
  return p_connection_id;
end;
$$;
