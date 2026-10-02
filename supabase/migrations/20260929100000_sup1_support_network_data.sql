-- ---------------------------------------------------------------------------
-- SUP-1 - Rede de Apoio: dados oficiais (CNES) em snapshot local (ADR-0031).
--
-- Migration **aditiva**: so tabelas e funcoes novas. Nenhuma linha existente
-- muda de significado.
--
-- - Snapshot local de fonte oficial, no precedente do e-MEC (ADR-0028):
--   arquivo baixado pelo owner -> importador -> snapshot inativo -> ativacao
--   atomica. Um ativo por fonte. Rollback = reativar o anterior.
-- - Dado publico/institucional: sem pessoa, sem CPF/CNS, sem profissional.
-- - LICENCA NAO RESOLVIDA: importacao de fonte real (`cnes_*`) nasce
--   BLOQUEADA no banco (`real_import_enabled = false`, so pode virar true com
--   `license_status = 'VERIFIED'`). Fixture de QA importa, mas so aparece com
--   `fixtures_visible = true` (default false).
-- - Vocabulario oficial sempre preservado (`official_type_code/name`). O
--   agrupamento de UX (`category`) e um mapa separado, versionado, e so e
--   exposto quando `confirmed = true`.
-- - Escrita so por `service_role` (importador, fora de `src/`); leitura so por
--   RPCs `SECURITY DEFINER` que devolvem a projecao permitida (sem hash nem
--   metadado interno).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Interruptores (singleton)
-- ---------------------------------------------------------------------------

create table public.support_network_settings (
  singleton boolean primary key default true check (singleton),
  license_status text not null default 'UNRESOLVED'
    check (license_status in ('UNRESOLVED', 'VERIFIED', 'BLOCKED')),
  real_import_enabled boolean not null default false,
  fixtures_visible boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now()),
  -- Dado real so com licenca verificada; nunca por descuido.
  constraint support_network_real_requires_license
    check (not real_import_enabled or license_status = 'VERIFIED')
);

insert into public.support_network_settings (singleton) values (true) on conflict do nothing;

comment on table public.support_network_settings is
  'SUP-1: interruptores da Rede de Apoio. Importacao real bloqueada ate licenca VERIFIED; fixture invisivel por padrao.';

-- ---------------------------------------------------------------------------
-- 2. Snapshots
-- ---------------------------------------------------------------------------

create table public.support_network_snapshots (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('cnes_download', 'cnes_api', 'qa_fixture')),
  -- Competencia/data de referencia publicada pela fonte.
  source_reference_date date not null,
  -- Nome do arquivo ou identificador do recurso oficial (nunca URL seguida).
  source_identifier text not null
    check (char_length(source_identifier) between 3 and 200 and source_identifier !~ '[[:cntrl:]]'),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  schema_version text not null check (schema_version ~ '^[a-z0-9][a-z0-9_.-]{2,60}$'),
  status text not null default 'staging'
    check (status in ('staging', 'inactive', 'active', 'superseded', 'failed')),
  record_count integer not null default 0 check (record_count >= 0),
  accepted_count integer not null default 0 check (accepted_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  imported_at timestamptz not null default timezone('utc', now()),
  activated_at timestamptz,
  -- Idempotencia: mesma fonte + competencia + arquivo nao gera segundo snapshot.
  constraint support_network_snapshots_identity unique (source, source_reference_date, source_sha256)
);

create unique index support_network_snapshots_one_active
  on public.support_network_snapshots (source) where status = 'active';

-- ---------------------------------------------------------------------------
-- 3. Tipos oficiais (por snapshot) e mapa de categoria de UX (versionado)
-- ---------------------------------------------------------------------------

create table public.support_facility_types (
  snapshot_id uuid not null references public.support_network_snapshots(id) on delete cascade,
  official_type_code text not null check (official_type_code ~ '^[0-9A-Za-z]{1,10}$'),
  official_type_name text not null check (char_length(official_type_name) between 1 and 200),
  primary key (snapshot_id, official_type_code)
);

create table public.support_facility_categories (
  official_type_code text primary key check (official_type_code ~ '^[0-9A-Za-z]{1,10}$'),
  category text not null check (category in ('primary_care', 'psychosocial_care', 'urgent_care')),
  mapping_version text not null check (mapping_version ~ '^[a-z0-9][a-z0-9_.-]{2,40}$'),
  -- De onde veio a correspondencia. `secondary_search` nunca e exposto.
  evidence text not null check (evidence in ('official_source_confirmed', 'secondary_search')),
  confirmed boolean not null default false,
  reviewed_at timestamptz,
  constraint support_facility_categories_confirmed_evidence
    check (not confirmed or (evidence = 'official_source_confirmed' and reviewed_at is not null))
);

-- Candidatos vistos em busca secundaria (tabela SCNES/wiki CNES). NAO
-- confirmados: nenhum rotulo de UX e exposto ate conferencia na fonte oficial.
insert into public.support_facility_categories (official_type_code, category, mapping_version, evidence, confirmed)
values
  ('02', 'primary_care', 'sup1-map-1', 'secondary_search', false),
  ('70', 'psychosocial_care', 'sup1-map-1', 'secondary_search', false),
  ('73', 'urgent_care', 'sup1-map-1', 'secondary_search', false)
on conflict (official_type_code) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Estabelecimentos (projecao minima; sem dado pessoal)
-- ---------------------------------------------------------------------------

create table public.support_facilities (
  snapshot_id uuid not null references public.support_network_snapshots(id) on delete cascade,
  cnes_code text not null check (cnes_code ~ '^[0-9]{7}$'),
  official_name text not null check (char_length(official_name) between 2 and 200),
  official_type_code text not null,
  municipality_code text not null check (municipality_code ~ '^[0-9]{6,7}$'),
  municipality_name text check (municipality_name is null or char_length(municipality_name) between 2 and 120),
  state_code text not null check (state_code in (
    'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA',
    'PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  postal_code text check (postal_code is null or postal_code ~ '^[0-9]{8}$'),
  address_street text check (address_street is null or char_length(address_street) <= 200),
  address_number text check (address_number is null or char_length(address_number) <= 30),
  address_complement text check (address_complement is null or char_length(address_complement) <= 120),
  address_district text check (address_district is null or char_length(address_district) <= 120),
  phone_display text check (phone_display is null or char_length(phone_display) <= 40),
  phone_digits text check (phone_digits is null or phone_digits ~ '^[0-9]{8,13}$'),
  -- Coordenada da UNIDADE (dado publico). Nunca a localizacao de uma pessoa.
  latitude numeric(9, 6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude is null or longitude between -180 and 180),
  coordinate_status text not null check (coordinate_status in ('valid', 'missing', 'invalid')),
  -- So quando a fonte declara situacao explicita; ausencia no snapshot NAO vira inativo.
  source_active boolean,
  source_updated_at date,
  primary key (snapshot_id, cnes_code),
  foreign key (snapshot_id, official_type_code)
    references public.support_facility_types (snapshot_id, official_type_code),
  constraint support_facilities_coordinates_shape check (
    (coordinate_status = 'valid') = (latitude is not null and longitude is not null)
  )
);

create index support_facilities_municipality_idx
  on public.support_facilities (snapshot_id, municipality_code, official_type_code);
create index support_facilities_type_idx
  on public.support_facilities (snapshot_id, official_type_code);

comment on table public.support_facilities is
  'SUP-1: estabelecimentos de saude publicados de um snapshot oficial (CNES). Sem pessoa. Valores literais da fonte; so normalizacao estrutural.';

-- ---------------------------------------------------------------------------
-- 5. RLS: ninguem de produto le ou escreve as tabelas direto
-- ---------------------------------------------------------------------------

alter table public.support_network_settings enable row level security;
alter table public.support_network_settings force row level security;
alter table public.support_network_snapshots enable row level security;
alter table public.support_network_snapshots force row level security;
alter table public.support_facility_types enable row level security;
alter table public.support_facility_types force row level security;
alter table public.support_facility_categories enable row level security;
alter table public.support_facility_categories force row level security;
alter table public.support_facilities enable row level security;
alter table public.support_facilities force row level security;

revoke all on table public.support_network_settings from public, anon, authenticated;
revoke all on table public.support_network_snapshots from public, anon, authenticated;
revoke all on table public.support_facility_types from public, anon, authenticated;
revoke all on table public.support_facility_categories from public, anon, authenticated;
revoke all on table public.support_facilities from public, anon, authenticated;

grant select, update on table public.support_network_settings to service_role;
grant select, insert, update, delete on table public.support_network_snapshots to service_role;
grant select, insert, delete on table public.support_facility_types to service_role;
grant select, insert, update on table public.support_facility_categories to service_role;
grant select, insert, delete on table public.support_facilities to service_role;

-- ---------------------------------------------------------------------------
-- 6. Guardas de escrita (valem inclusive para service_role: sao triggers)
-- ---------------------------------------------------------------------------

/* Fonte real so com licenca verificada e interruptor ligado. */
create or replace function public.support_network_guard_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings public.support_network_settings%rowtype;
begin
  select * into settings from public.support_network_settings where singleton;
  if tg_op = 'DELETE' then
    -- Snapshot publicado nao some: primeiro outro assume (superseded) ou rollback.
    if old.status = 'active' then
      raise exception 'active_snapshot_not_deletable' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.source <> 'qa_fixture' and not coalesce(settings.real_import_enabled, false) then
      raise exception 'real_import_disabled' using errcode = '42501';
    end if;
    if new.status <> 'staging' then
      raise exception 'snapshot_must_start_staging' using errcode = '22023';
    end if;
    return new;
  end if;
  -- Identidade e procedencia sao imutaveis.
  if new.source is distinct from old.source
     or new.source_reference_date is distinct from old.source_reference_date
     or new.source_sha256 is distinct from old.source_sha256
     or new.source_identifier is distinct from old.source_identifier
     or new.schema_version is distinct from old.schema_version
     or new.imported_at is distinct from old.imported_at then
    raise exception 'snapshot_provenance_immutable' using errcode = '22023';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'staging' and new.status in ('inactive', 'failed'))
    or (old.status = 'inactive' and new.status in ('active', 'failed'))
    or (old.status = 'active' and new.status = 'superseded')
    or (old.status = 'superseded' and new.status = 'active')
  ) then
    raise exception 'invalid_snapshot_transition' using errcode = '22023';
  end if;
  -- Contagens so mudam enquanto o snapshot esta em montagem.
  if old.status <> 'staging' and (
       new.record_count is distinct from old.record_count
    or new.accepted_count is distinct from old.accepted_count
    or new.rejected_count is distinct from old.rejected_count) then
    raise exception 'snapshot_counts_sealed' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.support_network_guard_snapshot() from public, anon, authenticated, service_role;

create trigger support_network_snapshots_guard
before insert or update or delete on public.support_network_snapshots
for each row execute function public.support_network_guard_snapshot();

/* Linha so entra ou sai de snapshot em montagem: dado publicado e imutavel. */
create or replace function public.support_network_guard_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := case when tg_op = 'DELETE' then old.snapshot_id else new.snapshot_id end;
  snapshot_status text;
begin
  select status into snapshot_status from public.support_network_snapshots where id = target;
  -- DELETE sem pai visivel = cascata da exclusao do snapshot (so nao-ativo, ver guarda do snapshot).
  if tg_op = 'DELETE' and snapshot_status is null then
    return old;
  end if;
  if snapshot_status is distinct from 'staging' then
    raise exception 'snapshot_not_staging' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.support_network_guard_rows() from public, anon, authenticated, service_role;

create trigger support_facilities_guard
before insert or delete on public.support_facilities
for each row execute function public.support_network_guard_rows();

create trigger support_facility_types_guard
before insert or delete on public.support_facility_types
for each row execute function public.support_network_guard_rows();

-- ---------------------------------------------------------------------------
-- 7. Ciclo do snapshot (service_role, importador)
-- ---------------------------------------------------------------------------

/* staging -> inactive, conferindo que as contagens batem com o que foi gravado. */
create or replace function public.support_network_seal_snapshot(
  p_snapshot_id uuid,
  p_record_count integer,
  p_rejected_count integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored integer;
begin
  select count(*) into stored from public.support_facilities where snapshot_id = p_snapshot_id;
  if stored = 0 then
    raise exception 'snapshot_empty' using errcode = '22023';
  end if;
  if p_record_count is null or p_rejected_count is null or stored + p_rejected_count <> p_record_count then
    raise exception 'snapshot_count_mismatch' using errcode = '22023';
  end if;
  update public.support_network_snapshots
  set record_count = p_record_count, accepted_count = stored, rejected_count = p_rejected_count
  where id = p_snapshot_id and status = 'staging';
  if not found then
    raise exception 'snapshot_not_staging' using errcode = '22023';
  end if;
  update public.support_network_snapshots set status = 'inactive' where id = p_snapshot_id;
end;
$$;

/*
  inactive -> active, atomico. O anterior da mesma fonte vira superseded na
  mesma transacao. Queda de contagem acima do limite bloqueia (fonte truncada
  ou filtro errado nao substitui dado bom em silencio).
*/
create or replace function public.support_network_activate_snapshot(
  p_snapshot_id uuid,
  p_max_drop_ratio numeric default 0.2
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.support_network_snapshots%rowtype;
  previous public.support_network_snapshots%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('support_network_activation'));
  select * into target from public.support_network_snapshots where id = p_snapshot_id for update;
  if not found then
    raise exception 'snapshot_not_found' using errcode = 'P0002';
  end if;
  if target.status <> 'inactive' then
    raise exception 'invalid_snapshot_transition' using errcode = '22023';
  end if;
  if target.source <> 'qa_fixture'
     and not coalesce((select real_import_enabled from public.support_network_settings where singleton), false) then
    raise exception 'real_import_disabled' using errcode = '42501';
  end if;
  if p_max_drop_ratio is null or p_max_drop_ratio < 0 or p_max_drop_ratio > 1 then
    raise exception 'invalid_drop_ratio' using errcode = '22023';
  end if;
  select * into previous from public.support_network_snapshots
  where source = target.source and status = 'active' for update;
  if found and target.accepted_count < previous.accepted_count * (1 - p_max_drop_ratio) then
    raise exception 'count_drop_exceeded' using errcode = '22023';
  end if;
  if found then
    update public.support_network_snapshots set status = 'superseded' where id = previous.id;
  end if;
  update public.support_network_snapshots
  set status = 'active', activated_at = timezone('utc', now())
  where id = target.id;
  return previous.id;
end;
$$;

/* Rollback: reativa um snapshot superseded da mesma fonte. */
create or replace function public.support_network_rollback_snapshot(p_snapshot_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.support_network_snapshots%rowtype;
  current_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('support_network_activation'));
  select * into target from public.support_network_snapshots where id = p_snapshot_id for update;
  if not found or target.status <> 'superseded' then
    raise exception 'snapshot_not_superseded' using errcode = '22023';
  end if;
  select id into current_id from public.support_network_snapshots
  where source = target.source and status = 'active' for update;
  if current_id is not null then
    update public.support_network_snapshots set status = 'superseded' where id = current_id;
  end if;
  update public.support_network_snapshots
  set status = 'active', activated_at = timezone('utc', now())
  where id = target.id;
  return current_id;
end;
$$;

revoke all on function public.support_network_seal_snapshot(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.support_network_activate_snapshot(uuid, numeric) from public, anon, authenticated;
revoke all on function public.support_network_rollback_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.support_network_seal_snapshot(uuid, integer, integer) to service_role;
grant execute on function public.support_network_activate_snapshot(uuid, numeric) to service_role;
grant execute on function public.support_network_rollback_snapshot(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Leitura (projecao) para o produto
-- ---------------------------------------------------------------------------

/*
  Snapshot visivel: o ativo de fonte real (so com importacao real ligada), senao
  o ativo de fixture (so com `fixtures_visible`). Fail-closed: nada visivel ->
  null -> zero linhas.
*/
create or replace function public.support_network_visible_snapshot()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select snapshot.id
       from public.support_network_snapshots snapshot, public.support_network_settings settings
      where settings.singleton and settings.real_import_enabled
        and snapshot.status = 'active' and snapshot.source <> 'qa_fixture'
      order by snapshot.activated_at desc
      limit 1),
    (select snapshot.id
       from public.support_network_snapshots snapshot, public.support_network_settings settings
      where settings.singleton and settings.fixtures_visible
        and snapshot.status = 'active' and snapshot.source = 'qa_fixture'
      limit 1)
  );
$$;

revoke all on function public.support_network_visible_snapshot() from public, anon, authenticated, service_role;

/* Procedencia do snapshot visivel. Sem hash, sem identificador interno. */
create or replace function public.support_network_provenance()
returns table (
  source text,
  is_fixture boolean,
  source_reference_date date,
  imported_at timestamptz,
  activated_at timestamptz,
  facility_count integer,
  age_days integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select snapshot.source,
         snapshot.source = 'qa_fixture',
         snapshot.source_reference_date,
         snapshot.imported_at,
         snapshot.activated_at,
         snapshot.accepted_count,
         greatest(0, (timezone('utc', now())::date - snapshot.source_reference_date))::integer
  from public.support_network_snapshots snapshot
  where snapshot.id = public.support_network_visible_snapshot();
$$;

create or replace function public.search_support_facilities(
  p_municipality_code text,
  p_official_type_codes text[] default null,
  p_category text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  cnes_code text,
  official_name text,
  official_type_code text,
  official_type_name text,
  category text,
  municipality_code text,
  municipality_name text,
  state_code text,
  postal_code text,
  address_street text,
  address_number text,
  address_complement text,
  address_district text,
  phone_display text,
  phone_digits text,
  latitude numeric,
  longitude numeric,
  coordinate_status text,
  source_active boolean,
  source_updated_at date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  visible uuid := public.support_network_visible_snapshot();
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_municipality_code is null or p_municipality_code !~ '^[0-9]{6,7}$' then
    raise exception 'invalid_municipality' using errcode = '22023';
  end if;
  if p_category is not null and p_category not in ('primary_care', 'psychosocial_care', 'urgent_care') then
    raise exception 'invalid_category' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 or p_offset > 10000 then
    raise exception 'invalid_page' using errcode = '22023';
  end if;
  if p_official_type_codes is not null and (
       cardinality(p_official_type_codes) > 20
       or exists (select 1 from unnest(p_official_type_codes) code where code !~ '^[0-9A-Za-z]{1,10}$')) then
    raise exception 'invalid_type_filter' using errcode = '22023';
  end if;
  if visible is null then
    return;
  end if;

  return query
  select f.cnes_code, f.official_name, f.official_type_code, t.official_type_name,
         case when c.confirmed then c.category end,
         f.municipality_code, f.municipality_name, f.state_code, f.postal_code,
         f.address_street, f.address_number, f.address_complement, f.address_district,
         f.phone_display, f.phone_digits,
         f.latitude, f.longitude, f.coordinate_status, f.source_active, f.source_updated_at
  from public.support_facilities f
  join public.support_facility_types t
    on t.snapshot_id = f.snapshot_id and t.official_type_code = f.official_type_code
  left join public.support_facility_categories c on c.official_type_code = f.official_type_code
  where f.snapshot_id = visible
    -- 6 digitos (CNES) e 7 (IBGE com verificador) casam pelo prefixo de 6.
    and left(f.municipality_code, 6) = left(p_municipality_code, 6)
    and f.source_active is distinct from false
    and (p_official_type_codes is null or f.official_type_code = any (p_official_type_codes))
    and (p_category is null or (c.confirmed and c.category = p_category))
  order by f.official_name, f.cnes_code
  limit p_limit offset p_offset;
end;
$$;

create or replace function public.get_support_facility(p_cnes_code text)
returns table (
  cnes_code text,
  official_name text,
  official_type_code text,
  official_type_name text,
  category text,
  municipality_code text,
  municipality_name text,
  state_code text,
  postal_code text,
  address_street text,
  address_number text,
  address_complement text,
  address_district text,
  phone_display text,
  phone_digits text,
  latitude numeric,
  longitude numeric,
  coordinate_status text,
  source_active boolean,
  source_updated_at date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_cnes_code is null or p_cnes_code !~ '^[0-9]{7}$' then
    raise exception 'invalid_cnes' using errcode = '22023';
  end if;
  return query
  select f.cnes_code, f.official_name, f.official_type_code, t.official_type_name,
         case when c.confirmed then c.category end,
         f.municipality_code, f.municipality_name, f.state_code, f.postal_code,
         f.address_street, f.address_number, f.address_complement, f.address_district,
         f.phone_display, f.phone_digits,
         f.latitude, f.longitude, f.coordinate_status, f.source_active, f.source_updated_at
  from public.support_facilities f
  join public.support_facility_types t
    on t.snapshot_id = f.snapshot_id and t.official_type_code = f.official_type_code
  left join public.support_facility_categories c on c.official_type_code = f.official_type_code
  where f.snapshot_id = public.support_network_visible_snapshot()
    and f.cnes_code = p_cnes_code;
end;
$$;

create or replace function public.list_support_facility_types()
returns table (official_type_code text, official_type_name text, category text, facility_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  return query
  select t.official_type_code, t.official_type_name,
         case when c.confirmed then c.category end,
         (select count(*)::integer from public.support_facilities f
           where f.snapshot_id = t.snapshot_id and f.official_type_code = t.official_type_code
             and f.source_active is distinct from false)
  from public.support_facility_types t
  left join public.support_facility_categories c on c.official_type_code = t.official_type_code
  where t.snapshot_id = public.support_network_visible_snapshot()
  order by t.official_type_code;
end;
$$;

revoke all on function public.support_network_provenance() from public, anon;
revoke all on function public.search_support_facilities(text, text[], text, integer, integer) from public, anon;
revoke all on function public.get_support_facility(text) from public, anon;
revoke all on function public.list_support_facility_types() from public, anon;
grant execute on function public.support_network_provenance() to authenticated, service_role;
grant execute on function public.search_support_facilities(text, text[], text, integer, integer) to authenticated;
grant execute on function public.get_support_facility(text) to authenticated;
grant execute on function public.list_support_facility_types() to authenticated;
