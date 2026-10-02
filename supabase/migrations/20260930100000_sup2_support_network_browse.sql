-- SUP-2 - Rede de Apoio: navegacao por municipio (ADR-0032).
--
-- Aditiva. Nenhuma tabela nova, nenhum dado novo: duas RPCs de LEITURA sobre o
-- snapshot visivel do SUP-1 (ADR-0031), com as mesmas regras de acesso da
-- projecao (so `authenticated`, `SECURITY DEFINER`, `search_path = ''`).
--
-- 1. `list_support_municipalities()` - catalogo de municipios que TEM unidade
--    no snapshot visivel. Nao cria base propria de municipios: o nome, a UF e o
--    codigo IBGE vem do proprio dado oficial. O "centro aproximado" e a media
--    das coordenadas VALIDAS das unidades, arredondada a 2 casas (~1 km): serve
--    para o navegador achar o municipio mais proximo da pessoa SEM enviar a
--    coordenada dela a lugar nenhum. Nao e sede municipal oficial.
-- 2. `list_support_municipality_types(p_municipality_code)` - tipos oficiais
--    presentes no municipio, com contagem; categoria so quando confirmada.
--
-- Nenhuma das duas recebe coordenada. Unidade com situacao explicita "inativa"
-- fica de fora, igual a busca do SUP-1.

create or replace function public.list_support_municipalities()
returns table (
  municipality_code text,
  municipality_name text,
  state_code text,
  facility_count integer,
  approx_latitude numeric,
  approx_longitude numeric
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
  if visible is null then
    return;
  end if;

  return query
  select max(f.municipality_code),
         max(f.municipality_name),
         max(f.state_code),
         count(*)::integer,
         round(avg(f.latitude) filter (where f.coordinate_status = 'valid'), 2),
         round(avg(f.longitude) filter (where f.coordinate_status = 'valid'), 2)
  from public.support_facilities f
  where f.snapshot_id = visible
    and f.source_active is distinct from false
  -- 6 e 7 digitos do mesmo municipio sao o mesmo municipio (prefixo IBGE).
  group by left(f.municipality_code, 6)
  order by max(f.municipality_name) nulls last, max(f.state_code), left(f.municipality_code, 6);
end;
$$;

create or replace function public.list_support_municipality_types(p_municipality_code text)
returns table (
  official_type_code text,
  official_type_name text,
  category text,
  facility_count integer
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
  if visible is null then
    return;
  end if;

  return query
  select t.official_type_code,
         t.official_type_name,
         case when bool_and(c.confirmed) then max(c.category) end,
         count(*)::integer
  from public.support_facilities f
  join public.support_facility_types t
    on t.snapshot_id = f.snapshot_id and t.official_type_code = f.official_type_code
  left join public.support_facility_categories c on c.official_type_code = f.official_type_code
  where f.snapshot_id = visible
    and left(f.municipality_code, 6) = left(p_municipality_code, 6)
    and f.source_active is distinct from false
  group by t.official_type_code, t.official_type_name
  order by t.official_type_name, t.official_type_code;
end;
$$;

revoke all on function public.list_support_municipalities() from public, anon;
revoke all on function public.list_support_municipality_types(text) from public, anon;
grant execute on function public.list_support_municipalities() to authenticated;
grant execute on function public.list_support_municipality_types(text) to authenticated;
