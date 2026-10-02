-- Stage 29 / F5 — Perfil de confianca: conferencia de credenciais e projecao
-- publica factual.
--
-- Somente aditivo: duas funcoes novas. As credenciais (tabela) nasceram no
-- F1-F3 (`20260927100000`). Nenhum contrato existente muda: o perfil publico do
-- PRO-5 continua igual; as credenciais saem por RPC propria.
--
-- Principio (ADR-0026 / Professional-Trust-Profile-Mapping): a Elyra apresenta
-- FATOS e diz quem os conferiu. Nunca avalia, ranqueia nem recomenda. A
-- projecao publica nao carrega digest, fonte, reviewer, documento nem motivo.

-- ---------------------------------------------------------------------------
-- 1. Reviewer confere (ou desfaz a conferencia de) uma credencial
-- ---------------------------------------------------------------------------

create or replace function public.review_professional_credential(
  p_credential_id uuid,
  p_verified boolean,
  p_source text default null,
  p_evidence_digest text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target public.professional_credentials%rowtype;
begin
  if actor_id is null or not public.professional_reviewer_is_active(actor_id) then
    raise exception 'reviewer required' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'reviewer mfa required' using errcode = '42501';
  end if;

  select * into target from public.professional_credentials
  where id = p_credential_id
  for update;
  if not found then
    raise exception 'credential unavailable' using errcode = '42501';
  end if;
  if target.user_id = actor_id then
    raise exception 'self review forbidden' using errcode = '42501';
  end if;

  if p_verified then
    if p_source not in ('issuer_manual', 'document_manual') then
      raise exception 'invalid credential source' using errcode = '22023';
    end if;
    if p_evidence_digest is null or p_evidence_digest !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid evidence digest' using errcode = '22023';
    end if;
    update public.professional_credentials
    set trust_state = 'verified',
        verified_at = statement_timestamp(),
        evidence_digest = p_evidence_digest,
        verification_source = p_source,
        policy_version = 'stage29.f5.v1'
    where id = p_credential_id;
  else
    update public.professional_credentials
    set trust_state = 'declared',
        verified_at = null,
        evidence_digest = null,
        verification_source = null,
        policy_version = null
    where id = p_credential_id;
  end if;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id,
    case when p_verified then 'professional_credential.verified' else 'professional_credential.unverified' end,
    'professional_credential', p_credential_id, 'success', gen_random_uuid()
  );
end;
$$;

revoke all on function public.review_professional_credential(uuid, boolean, text, text) from public, anon, service_role;
grant execute on function public.review_professional_credential(uuid, boolean, text, text) to authenticated;

-- Fila de conferencia de credenciais: so o necessario para conferir no emissor.
create or replace function public.list_professional_credential_queue()
returns table (
  credential_id uuid,
  professional_user_id uuid,
  kind text,
  title text,
  institution text,
  start_year smallint,
  end_year smallint,
  expires_on date,
  trust_state text,
  updated_at timestamptz
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
  return query
  select c.id, c.user_id, c.kind, c.title, c.institution, c.start_year, c.end_year,
         c.expires_on, c.trust_state, c.updated_at
  from public.professional_credentials c
  join public.professional_profiles profile on profile.user_id = c.user_id
  where c.user_id <> actor_id
    and c.trust_state = 'declared'
    and profile.council_region is not null
  order by c.updated_at asc
  limit 200;
end;
$$;

revoke all on function public.list_professional_credential_queue() from public, anon, service_role;
grant execute on function public.list_professional_credential_queue() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Projecao publica factual das credenciais de um perfil listado
--
-- Mesma elegibilidade do perfil publico (listado + verificacao vigente), mesmo
-- balde anti-abuso. Certificacao vencida sai da vitrine. Ordem fixa por tipo e
-- posicao declarada — nunca por "qualidade".
-- ---------------------------------------------------------------------------

create or replace function public.list_professional_directory_credentials(p_slug text)
returns table (
  kind text,
  title text,
  institution text,
  start_year smallint,
  end_year smallint,
  expires_on date,
  trust_state text,
  verified_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_slug is null or p_slug !~ '^[0-9a-f]{16}$' then
    return;
  end if;
  perform public.professional_directory_consume(actor);
  return query
    select c.kind, c.title, c.institution, c.start_year, c.end_year, c.expires_on,
           c.trust_state, c.verified_at
    from public.professional_public_profiles pub
    join public.professional_credentials c on c.user_id = pub.user_id
    where pub.slug = p_slug
      and pub.listed
      and public.professional_verification_is_current(pub.user_id)
      and (c.expires_on is null or c.expires_on >= current_date)
    order by case c.kind when 'education' then 1 when 'experience' then 2 else 3 end,
             c.position, c.created_at;
end;
$$;

revoke all on function public.list_professional_directory_credentials(text) from public, anon;
grant execute on function public.list_professional_directory_credentials(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Seed e QA locais (demo profissional, fixtures E2E) usam o cliente admin
--
-- Mesmo padrao de `professional_public_profiles` (PRO-5), mais estreito: sem
-- UPDATE. Mudar o estado de confianca de uma credencial existente continua
-- exclusivo da RPC do reviewer. O produto nao usa service_role aqui
-- (`admin-client-usage.test.ts`).
-- ---------------------------------------------------------------------------

grant select, insert, delete on table public.professional_credentials to service_role;
