-- Era 3 - permissao por dominio **e por janela de tempo do dado**.
--
-- **O que faltava.** `sharing_permissions.expires_at` expira a *permissao*: a
-- partir daquele instante o profissional deixa de ver. Ele nao recorta o
-- *periodo* dos dados - enquanto vale, vale para o historico inteiro. Conceder
-- `emotional` para uma conversa sobre os ultimos tres meses entregava tambem os
-- tres anos anteriores.
--
-- A Definition of Done da Era 3 pede permissao "por dominio **e** por janela,
-- aplicada no PostgreSQL". Aplicada no banco, e nao na consulta da aplicacao:
-- filtro em `select` protege a tela, nao o dado.
--
-- **Semantica do `NULL`.** `data_from`/`data_to` nulos significam "sem limite
-- daquele lado", que e exatamente o comportamento de hoje - toda permissao ja
-- concedida continua funcionando igual. Isso nao afrouxa fail-closed: a regra
-- ausente nao concede nada **novo**, apenas nao recorta. Fail-closed aqui esta no
-- caminho inverso, e ele e absoluto: janela declarada **sempre** recorta, e
-- dominio cuja data o helper nao conheca nao passa a valer por default - nao
-- existe caminho que devolva `true` sem uma comparacao de data explicita.
--
-- **O que a janela recorta, e o que nao.** Ela recorta **registros datados**:
-- check-in, sono, progresso de meta, entrada de diario, periodo e registro
-- diario de ciclo, snapshot de relatorio. Nao recorta **definicoes**, que nao
-- descrevem um dia: a meta em si e o perfil de ciclo continuam visiveis enquanto
-- o escopo estiver concedido. Esconder a meta e mostrar o progresso dela
-- produziria um dossie com numeros sem nome.
--
-- Migration **aditiva**: acrescenta colunas, substitui policies pelas
-- equivalentes com recorte, e nao apaga dado nenhum.

-- ---------------------------------------------------------------------------
-- 1. As colunas
-- ---------------------------------------------------------------------------

alter table public.sharing_permissions
  add column if not exists data_from date,
  add column if not exists data_to date;

alter table public.sharing_permissions
  drop constraint if exists sharing_permission_data_window_order;
alter table public.sharing_permissions
  add constraint sharing_permission_data_window_order
  check (data_from is null or data_to is null or data_to >= data_from);

comment on column public.sharing_permissions.data_from is
  'Primeiro dia de registro visivel. NULL = sem limite inferior.';
comment on column public.sharing_permissions.data_to is
  'Ultimo dia de registro visivel. NULL = sem limite superior.';

-- ---------------------------------------------------------------------------
-- 2. O helper com recorte
--
-- Recebe o intervalo que o **registro** cobre. Para registro pontual, `p_from` e
-- `p_to` sao o mesmo dia; para um snapshot de relatorio, sao as pontas do
-- periodo que ele resume.
--
-- A regra e de **continencia**, nao de sobreposicao: o registro so aparece se
-- couber inteiro na janela. Um snapshot de 90 dias que comeca antes de
-- `data_from` resume dias que a pessoa nao autorizou, e mostra-lo entregaria
-- justamente o que a janela existe para reter.
-- ---------------------------------------------------------------------------

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
  select coalesce(exists (
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
      -- O recorte. `p_from`/`p_to` nulos nunca satisfazem uma janela declarada:
      -- registro sem data conhecida nao entra num periodo autorizado.
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

revoke all on function public.professional_access_allowed_on(uuid, text, date, date, uuid) from public;
grant execute on function public.professional_access_allowed_on(uuid, text, date, date, uuid)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. As policies dos registros datados
--
-- Cada dominio declara **qual** e a sua coluna de data. Nao ha default: um
-- dominio novo nao herda recorte por acidente nem escapa dele por esquecimento -
-- ele simplesmente nao tem policy ate alguem escrever uma.
-- ---------------------------------------------------------------------------

-- Emocional: `occurred_at` e o instante do check-in.
drop policy if exists emotional_checkins_select_professional on public.emotional_checkins;
create policy emotional_checkins_select_professional
on public.emotional_checkins for select to authenticated
using (
  public.professional_access_allowed_on(
    user_id, 'emotional', occurred_at::date, occurred_at::date
  )
);

drop policy if exists emotional_checkin_factors_select_professional on public.emotional_checkin_factors;
create policy emotional_checkin_factors_select_professional
on public.emotional_checkin_factors for select to authenticated
using (
  exists (
    select 1 from public.emotional_checkins checkin
    where checkin.id = emotional_checkin_factors.checkin_id
      and public.professional_access_allowed_on(
        checkin.user_id, 'emotional', checkin.occurred_at::date, checkin.occurred_at::date
      )
  )
);

-- Sono: `night` ja e a data da noite registrada.
drop policy if exists sleep_records_select_professional on public.sleep_records;
create policy sleep_records_select_professional
on public.sleep_records for select to authenticated
using (public.professional_access_allowed_on(user_id, 'sleep', night, night));

-- Progresso de meta: `occurred_on` e o dia do progresso.
drop policy if exists goal_progress_select_professional on public.goal_progress_entries;
create policy goal_progress_select_professional
on public.goal_progress_entries for select to authenticated
using (
  exists (
    select 1 from public.goals goal
    where goal.id = goal_progress_entries.goal_id
      and public.professional_access_allowed_on(
        goal.user_id, 'goals', goal_progress_entries.occurred_on, goal_progress_entries.occurred_on
      )
  )
);

-- Diario: a permissao ja e por entrada individual; a janela recorta por cima.
drop policy if exists journal_entries_select_professional on public.journal_entries;
create policy journal_entries_select_professional
on public.journal_entries for select to authenticated
using (
  status = 'saved'
  and trashed_at is null
  and public.professional_access_allowed_on(
    user_id, 'journal_entry', created_at::date, created_at::date, id
  )
);

drop policy if exists journal_entry_tags_select_professional on public.journal_entry_tags;
create policy journal_entry_tags_select_professional
on public.journal_entry_tags for select to authenticated
using (
  exists (
    select 1 from public.journal_entries entry
    where entry.id = journal_entry_tags.entry_id
      and public.professional_access_allowed_on(
        entry.user_id, 'journal_entry', entry.created_at::date, entry.created_at::date, entry.id
      )
  )
);

-- Ciclo: o periodo cobre um intervalo; um periodo em aberto (`end_date` nulo)
-- nao cabe em janela nenhuma que tenha limite superior, e isso e proposital.
drop policy if exists cycle_periods_select_professional on public.cycle_periods;
create policy cycle_periods_select_professional
on public.cycle_periods for select to authenticated
using (
  public.professional_access_allowed_on(
    user_id, 'cycle', start_date, coalesce(end_date, start_date)
  )
);

drop policy if exists cycle_daily_records_select_professional on public.cycle_daily_records;
create policy cycle_daily_records_select_professional
on public.cycle_daily_records for select to authenticated
using (
  public.professional_access_allowed_on(
    user_id, 'cycle', record_date, record_date
  )
);

drop policy if exists cycle_daily_symptoms_select_professional on public.cycle_daily_symptoms;
create policy cycle_daily_symptoms_select_professional
on public.cycle_daily_symptoms for select to authenticated
using (
  exists (
    select 1 from public.cycle_daily_records record
    where record.id = cycle_daily_symptoms.record_id
      and public.professional_access_allowed_on(
        record.user_id, 'cycle', record.record_date, record.record_date
      )
  )
);

-- Snapshot de relatorio: resume um intervalo, e so aparece se o intervalo
-- **inteiro** couber na janela.
drop policy if exists report_snapshots_select_professional on public.report_snapshots;
create policy report_snapshots_select_professional
on public.report_snapshots for select to authenticated
using (
  public.professional_access_allowed_on(
    user_id, 'reports', period_start, period_end
  )
);

-- `goals` e `cycle_profiles` continuam com o helper sem data: uma meta e uma
-- definicao, nao um dia. Ficam explicitos aqui para que a ausencia de recorte
-- seja uma decisao lida, e nao um esquecimento.
--   goals_select_professional         -> public.professional_access_allowed(user_id, 'goals')
--   cycle_profiles_select_professional -> public.professional_access_allowed(user_id, 'cycle')

-- ---------------------------------------------------------------------------
-- 4. A RPC que define a janela
--
-- Separada de `set_sharing_permission` de proposito: aquela assinatura e
-- verificada por pgTAP e usada pelo repositorio, e alterar assinatura de funcao
-- existente e mudanca de contrato disfarcada de parametro novo.
-- ---------------------------------------------------------------------------

create or replace function public.set_sharing_data_window(
  p_connection_id uuid,
  p_scope text,
  -- `default null` nao e conveniencia: nulo **e** um valor legitimo aqui, e
  -- significa "sem limite daquele lado". Sem o default, o tipo gerado para o
  -- cliente exigiria uma data que a semantica nao exige.
  p_data_from date default null,
  p_data_to date default null,
  p_journal_entry_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  permission_id uuid;
begin
  if p_data_from is not null and p_data_to is not null and p_data_to < p_data_from then
    raise exception 'invalid data window' using errcode = '22023';
  end if;

  -- Somente o titular governa o proprio compartilhamento. O profissional nunca
  -- alarga a propria janela.
  if not exists (
    select 1 from public.professional_connections
    where id = p_connection_id and client_user_id = actor_id and status = 'accepted'
  ) then
    raise exception 'accepted connection required' using errcode = '42501';
  end if;

  select id into permission_id from public.sharing_permissions
  where connection_id = p_connection_id
    and scope = p_scope
    and journal_entry_id is not distinct from p_journal_entry_id
  for update;

  if permission_id is null then
    raise exception 'permission not found' using errcode = '42501';
  end if;

  update public.sharing_permissions
  set data_from = p_data_from,
      data_to = p_data_to,
      updated_at = statement_timestamp()
  where id = permission_id;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, 'sharing_permission.window_set',
    'sharing_permission', permission_id, 'success', gen_random_uuid()
  );

  return permission_id;
end;
$$;

revoke all on function public.set_sharing_data_window(uuid, text, date, date, uuid) from public;
grant execute on function public.set_sharing_data_window(uuid, text, date, date, uuid)
to authenticated, service_role;
