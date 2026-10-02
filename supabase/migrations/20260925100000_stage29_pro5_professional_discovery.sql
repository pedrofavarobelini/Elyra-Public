-- Stage 29 / PRO-5 - Descoberta profissional.
--
-- DoD: perfil publico minimo + opt-in + filtros + anti-scraping.
--
-- Principios:
-- - a descoberta mostra FATOS: sem ranking, score, estrela, review ou
--   "recomendado". Ordem alfabetica, visivel na tela;
-- - perfil publico em tabela PROPRIA, so com campos publicaveis. Nada de
--   `professional_profiles.*` em superficie publica: CPF, e-mail, telefone,
--   documento, reviewer, digest, notas, grants e vinculos nunca passam por aqui;
-- - opt-in: `listed` nasce FALSE; desligar remove na proxima consulta;
-- - elegibilidade calculada NA LEITURA (sem job): perfil publico `listed` +
--   verificacao vigente (`professional_verification_is_current`: verified e
--   revisao nao vencida; suspended/rejected/pending/expired ficam fora);
-- - terceiros NUNCA leem a tabela: so a RPC `security definer`, com projecao
--   fixa, paginacao limitada, entrada validada e vazao por conta (o RPC e
--   chamavel direto via PostgREST com o JWT do usuario, entao o limite mora
--   aqui, e nao so no app);
-- - so `authenticated`: a descoberta nao e anonima (menos superficie publica).
--
-- Aditiva: nenhuma tabela existente e alterada ou removida.

-- ---------------------------------------------------------------------------
-- 1. Normalizacao de busca (acentos e caixa), imutavel para colunas geradas.
-- ---------------------------------------------------------------------------

create or replace function public.directory_normalize(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(
    btrim(regexp_replace(
      translate(lower(coalesce(p_value, '')),
        'áàâãäåéèêëíìîïóòôõöúùûüçñ',
        'aaaaaaeeeeiiiiooooouuuucn'),
      '\s+', ' ', 'g')),
    '');
$$;

revoke all on function public.directory_normalize(text) from public, anon;
grant execute on function public.directory_normalize(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Perfil publico
-- ---------------------------------------------------------------------------

create table public.professional_public_profiles (
  user_id uuid primary key
    references public.professional_profiles(user_id) on delete cascade,
  -- Nao enumeravel: aleatorio, nunca derivado de nome, UUID ou registro.
  slug text not null unique
    default substring(replace(gen_random_uuid()::text, '-', '') from 1 for 16)
    check (slug ~ '^[0-9a-f]{16}$'),
  listed boolean not null default false,
  display_name text check (display_name is null or char_length(btrim(display_name)) between 2 and 80),
  bio text check (bio is null or char_length(bio) <= 600),
  city text check (city is null or char_length(btrim(city)) between 2 and 60),
  state text check (state is null or state in (
    'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
    'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
  )),
  modalities text[] not null default '{}'
    check (modalities <@ array['online','in_person']::text[] and cardinality(modalities) <= 2),
  areas text[] not null default '{}'
    check (areas <@ array[
      'ansiedade','autoestima','estresse','luto','relacionamentos','familia',
      'trabalho_carreira','sono_rotina','adolescencia','parentalidade',
      'diversidade','transicoes'
    ]::text[] and cardinality(areas) <= 6),
  languages text[] not null default '{}'
    check (languages <@ array['pt','en','es','libras']::text[] and cardinality(languages) <= 4),
  name_normalized text generated always as (public.directory_normalize(display_name)) stored,
  city_normalized text generated always as (public.directory_normalize(city)) stored,
  search_normalized text generated always as (
    public.directory_normalize(coalesce(display_name, '') || ' ' || coalesce(city, ''))
  ) stored,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  -- Publicar exige perfil completo: nada de card vazio na descoberta.
  constraint professional_public_profile_listed_shape check (
    not listed or (
      display_name is not null and city is not null and state is not null
      and cardinality(modalities) >= 1 and cardinality(areas) >= 1
      and cardinality(languages) >= 1
    )
  )
);

comment on table public.professional_public_profiles is
  'PRO-5: perfil publico opt-in. So campos publicaveis; leitura de terceiros apenas por search/get_professional_directory.';
comment on column public.professional_public_profiles.areas is
  'Areas DECLARADAS pelo profissional (vocabulario fechado). A Elyra nao as certifica.';

create index professional_public_profiles_listed_name_idx
  on public.professional_public_profiles (name_normalized, slug) where listed;
create index professional_public_profiles_listed_place_idx
  on public.professional_public_profiles (state, city_normalized) where listed;

create trigger professional_public_profiles_touch
  before update on public.professional_public_profiles
  for each row execute function public.set_updated_at();

alter table public.professional_public_profiles enable row level security;

-- Somente o dono le e edita a propria linha. Nao ha politica para terceiros.
create policy professional_public_profiles_owner_select
  on public.professional_public_profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy professional_public_profiles_owner_insert
  on public.professional_public_profiles for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy professional_public_profiles_owner_update
  on public.professional_public_profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy professional_public_profiles_owner_delete
  on public.professional_public_profiles for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.professional_public_profiles from anon, authenticated;
grant select, delete on public.professional_public_profiles to authenticated;
-- `slug` e `user_id` nao sao editaveis depois de criados; geradas nunca.
grant insert (user_id, listed, display_name, bio, city, state, modalities, areas, languages)
  on public.professional_public_profiles to authenticated;
grant update (listed, display_name, bio, city, state, modalities, areas, languages)
  on public.professional_public_profiles to authenticated;
-- Fixtures de QA e demo local (nunca caminho de produto), como nas demais tabelas.
grant all on table public.professional_public_profiles to service_role;

-- ---------------------------------------------------------------------------
-- 3. Vazao da descoberta (anti-scraping). Guarda so conta e instante: nunca o
--    termo buscado, filtro ou perfil aberto.
-- ---------------------------------------------------------------------------

create table public.professional_directory_access (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  occurred_at timestamptz not null default statement_timestamp()
);

create index professional_directory_access_user_idx
  on public.professional_directory_access (user_id, occurred_at desc);

alter table public.professional_directory_access enable row level security;
revoke all on public.professional_directory_access from anon, authenticated;

comment on table public.professional_directory_access is
  'PRO-5: contador de vazao da descoberta (conta + instante). Sem conteudo de busca. Retencao de 10 minutos.';

create or replace function public.professional_directory_consume(p_actor uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  recent integer;
begin
  delete from public.professional_directory_access
  where occurred_at < statement_timestamp() - interval '10 minutes';
  select count(*) into recent
  from public.professional_directory_access
  where user_id = p_actor and occurred_at > statement_timestamp() - interval '1 minute';
  if recent >= 60 then
    raise exception 'directory rate limited' using errcode = '54000';
  end if;
  insert into public.professional_directory_access (user_id) values (p_actor);
end;
$$;

revoke all on function public.professional_directory_consume(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Leitura publica: projecao fixa, elegibilidade na hora
-- ---------------------------------------------------------------------------

create or replace function public.search_professional_directory(
  p_query text default null,
  p_state text default null,
  p_city text default null,
  p_modality text default null,
  p_area text default null,
  p_language text default null,
  p_page integer default 1,
  p_page_size integer default 12
)
returns table (
  slug text,
  display_name text,
  council text,
  council_region text,
  registration_number text,
  specialty text,
  verified_at timestamptz,
  city text,
  state text,
  modalities text[],
  areas text[],
  languages text[],
  has_more boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  v_query text;
  v_city text;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_page is null or p_page < 1 or p_page > 50
    or p_page_size is null or p_page_size < 1 or p_page_size > 24
    or char_length(coalesce(p_query, '')) > 60
    or char_length(coalesce(p_city, '')) > 60
    or (p_state is not null and p_state !~ '^[A-Z]{2}$')
    or (p_modality is not null and p_modality not in ('online', 'in_person'))
    or (p_area is not null and p_area !~ '^[a-z_]{2,40}$')
    or (p_language is not null and p_language not in ('pt', 'en', 'es', 'libras')) then
    raise exception 'invalid directory query' using errcode = '22023';
  end if;

  perform public.professional_directory_consume(actor);

  v_query := public.directory_normalize(p_query);
  v_query := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_');
  v_city := public.directory_normalize(p_city);

  return query
    with page as (
      select pub.slug, pub.display_name, prof.council, prof.council_region,
             prof.registration_number, prof.specialty,
             prof.verification_reviewed_at as verified_at,
             pub.city, pub.state, pub.modalities, pub.areas, pub.languages,
             pub.name_normalized
      from public.professional_public_profiles pub
      join public.professional_profiles prof on prof.user_id = pub.user_id
      where pub.listed
        and public.professional_verification_is_current(pub.user_id)
        and prof.council_region is not null
        and (p_state is null or pub.state = p_state)
        and (v_city is null or pub.city_normalized = v_city)
        and (p_modality is null or p_modality = any(pub.modalities))
        and (p_area is null or p_area = any(pub.areas))
        and (p_language is null or p_language = any(pub.languages))
        and (v_query is null or pub.search_normalized like '%' || v_query || '%')
      order by pub.name_normalized, pub.slug
      limit p_page_size + 1
      offset (p_page - 1) * p_page_size
    )
    select page.slug, page.display_name, page.council, page.council_region,
           page.registration_number, page.specialty, page.verified_at,
           page.city, page.state, page.modalities, page.areas, page.languages,
           (count(*) over () > p_page_size) as has_more
    from page
    order by page.name_normalized, page.slug
    limit p_page_size;
end;
$$;

create or replace function public.get_professional_directory_profile(p_slug text)
returns table (
  slug text,
  display_name text,
  council text,
  council_region text,
  registration_number text,
  specialty text,
  verified_at timestamptz,
  city text,
  state text,
  modalities text[],
  areas text[],
  languages text[],
  bio text
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
  -- Slug malformado, inexistente ou nao elegivel: a mesma resposta vazia.
  if p_slug is null or p_slug !~ '^[0-9a-f]{16}$' then
    return;
  end if;
  perform public.professional_directory_consume(actor);
  return query
    select pub.slug, pub.display_name, prof.council, prof.council_region,
           prof.registration_number, prof.specialty,
           prof.verification_reviewed_at, pub.city, pub.state,
           pub.modalities, pub.areas, pub.languages, pub.bio
    from public.professional_public_profiles pub
    join public.professional_profiles prof on prof.user_id = pub.user_id
    where pub.slug = p_slug
      and pub.listed
      and public.professional_verification_is_current(pub.user_id)
      and prof.council_region is not null;
end;
$$;

revoke all on function public.search_professional_directory(text, text, text, text, text, text, integer, integer)
  from public, anon;
revoke all on function public.get_professional_directory_profile(text) from public, anon;
grant execute on function public.search_professional_directory(text, text, text, text, text, text, integer, integer)
  to authenticated;
grant execute on function public.get_professional_directory_profile(text) to authenticated;
