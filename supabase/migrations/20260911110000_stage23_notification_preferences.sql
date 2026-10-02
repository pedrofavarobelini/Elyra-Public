-- ---------------------------------------------------------------------------
-- Stage 23 / Gate 23-A - preferencia de notificacao por canal x tipo.
--
-- A V1 governava notificacao com dois booleanos em `user_preferences`. A
-- pergunta que a pessoa realmente faz nao e "quero notificacao?", e sim "quero
-- *este aviso* *por este caminho*?" - e um interruptor unico obriga a escolher
-- entre tudo e nada.
--
-- Esta migration e **aditiva**. As colunas `checkin_reminder` e `goal_reminder`
-- continuam existindo e continuam sendo verdade: elas passam a ser a face
-- legada do par `(tipo, in_app)`, mantida em sincronia por trigger. Remove-las
-- seria migration destrutiva - HARD STOP pela politica - e quebraria o E2E
-- homologado da Stage 17, que escreve nelas diretamente.
--
-- Licao do `L-159`, aplicada aqui de proposito: quando o vocabulario de um
-- `check` muda, varrer **todas** as constraints que carregam esse vocabulario.
-- Ampliar `notifications_kind_check` sem ampliar `notifications_event_key_check`
-- produziria exatamente a falha silenciosa que custou o detalhe temporal da
-- Era 4 - o insert seria recusado por uma segunda regra que ninguem lembrou.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. A matriz
-- ---------------------------------------------------------------------------

create table if not exists public.notification_preferences (
  user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  kind text not null check (
    kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice')
  ),
  channel text not null check (channel in ('in_app', 'web_push')),
  /*
    Nasce `false`. Canal novo nunca chega ligado: silencio e estado valido, e
    consentimento presumido para interromper alguem nao e consentimento.
    A semeadura abaixo liga apenas o que a pessoa ja tinha ligado antes.
  */
  enabled boolean not null default false,
  /*
    Adiamento com prazo real, e nao "some por cinco minutos".

    `null` = sem adiamento. Enquanto a data for futura, o par nao entrega — e a
    tela mostra ate quando, porque silencio sem prazo visivel e indistinguivel
    de defeito.
  */
  snoozed_until timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, kind, channel)
);

comment on table public.notification_preferences is
  'Preferencia de notificacao por canal x tipo. Owner-only. Silencio e estado valido.';
comment on column public.notification_preferences.snoozed_until is
  'Adiamento com prazo. Futuro = nao entrega naquele par; null = sem adiamento.';

create index if not exists notification_preferences_user_idx
  on public.notification_preferences (user_id);

create trigger notification_preferences_set_updated_at
before update on public.notification_preferences
for each row execute function public.set_updated_at();

alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;

revoke all on table public.notification_preferences from anon, authenticated;
grant select, insert, update on table public.notification_preferences to authenticated;
grant all on table public.notification_preferences to service_role;

/*
  Sem `delete` para `authenticated`, igual a `user_preferences`: apagar a linha
  nao e a forma de recusar um aviso — desligar e. Uma matriz com buraco seria
  ambigua entre "nunca decidi" e "decidi que nao".
*/
create policy notification_preferences_select_own
on public.notification_preferences for select to authenticated
using ((select auth.uid()) = user_id);

create policy notification_preferences_insert_own
on public.notification_preferences for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy notification_preferences_update_own
on public.notification_preferences for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 2. Semeadura: a matriz completa, derivada do que a pessoa ja escolheu
-- ---------------------------------------------------------------------------

/*
  A matriz nasce **inteira**, e nao sob demanda.

  Linha ausente exigiria que todo leitor decidisse o que fazer com a ausencia, e
  cada leitor decidiria diferente. Com a matriz completa, `enabled` responde
  sozinho, e a unica pergunta que sobra e se o canal existe nesta instalacao —
  o que e propriedade do ambiente, e nao da pessoa.
*/
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
    -- In-app herda a decisao que ja existia. Ausencia de linha legada cai no
    -- default historico da coluna (`true`), e nao em `false`: desligar por
    -- efeito colateral de migration seria mudar a escolha de alguem.
    (p_user_id, 'checkin_reminder', 'in_app', coalesce(legacy.checkin_reminder, true)),
    (p_user_id, 'goal_reminder',    'in_app', coalesce(legacy.goal_reminder, true)),
    -- Tipos novos nascem desligados. O digest e opt-in por desenho, e ligar um
    -- aviso novo para quem nunca pediu seria decidir pela pessoa.
    (p_user_id, 'weekly_digest',    'in_app', false),
    -- Aviso de servico chega no aplicativo: ele fala do funcionamento da Elyra,
    -- e nao do comportamento de quem usa.
    (p_user_id, 'system_notice',    'in_app', true),
    -- Push nasce inteiro desligado: exige permissao do navegador, gesto
    -- explicito e canal disponivel na instalacao.
    (p_user_id, 'checkin_reminder', 'web_push', false),
    (p_user_id, 'goal_reminder',    'web_push', false),
    (p_user_id, 'weekly_digest',    'web_push', false),
    (p_user_id, 'system_notice',    'web_push', false)
  on conflict (user_id, kind, channel) do nothing;
end;
$$;

revoke all on function public.seed_notification_preferences(uuid)
from public, anon, authenticated;
grant execute on function public.seed_notification_preferences(uuid) to service_role;

-- Backfill de quem ja existe. Idempotente pelo `on conflict`.
select public.seed_notification_preferences(user_id)
from public.user_preferences;

-- ---------------------------------------------------------------------------
-- 3. A ponte com a face legada
-- ---------------------------------------------------------------------------

/*
  Uma fonte da verdade, duas faces.

  `user_preferences.checkin_reminder` e `goal_reminder` continuam sendo escritas
  por codigo existente e por QA. Em vez de duplicar decisao — o defeito que a
  Era 2 registrou ao recusar um segundo motor de calculo —, a coluna legada
  **propaga** para o par `(tipo, in_app)` da matriz, que e o que a materializacao
  passa a ler. Quem escreve na face antiga continua sendo obedecido.

  O caminho inverso (matriz -> coluna) vive no servico, que escreve os dois
  quando o par e `in_app`: um trigger em cada direcao criaria recursao.
*/
create or replace function public.sync_legacy_notification_preferences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_notification_preferences(new.user_id);

  update public.notification_preferences
  set enabled = new.checkin_reminder
  where user_id = new.user_id
    and kind = 'checkin_reminder'
    and channel = 'in_app'
    and enabled is distinct from new.checkin_reminder;

  update public.notification_preferences
  set enabled = new.goal_reminder
  where user_id = new.user_id
    and kind = 'goal_reminder'
    and channel = 'in_app'
    and enabled is distinct from new.goal_reminder;

  return new;
end;
$$;

create trigger user_preferences_sync_notification_matrix
after insert or update of checkin_reminder, goal_reminder
on public.user_preferences
for each row execute function public.sync_legacy_notification_preferences();

-- ---------------------------------------------------------------------------
-- 4. Vocabulario de `notifications` - as DUAS constraints, juntas
-- ---------------------------------------------------------------------------

alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice'));

/*
  `event_key` carrega a **janela** do aviso, e a janela nao e a mesma para todo
  tipo: lembrete e diario, digest e semanal. O formato ISO de semana
  (`YYYY-Www`) e o que da ao digest a mesma garantia que a data da ao lembrete —
  uma unica entrega por janela, imposta pelo unique `(user_id, event_key)`.

  `notifications_event_kind_match` continua valendo sem alteracao: ela compara o
  prefixo com `kind`, e nao conhece o formato do sufixo.
*/
alter table public.notifications
  drop constraint if exists notifications_event_key_check;
alter table public.notifications
  add constraint notifications_event_key_check
  check (
    event_key ~ '^(checkin_reminder|goal_reminder|system_notice):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or event_key ~ '^weekly_digest:[0-9]{4}-W[0-9]{2}$'
  );

-- ---------------------------------------------------------------------------
-- 5. Materializacao: passa a ler a matriz, e respeita o adiamento
-- ---------------------------------------------------------------------------

/*
  O que muda em relacao a Stage 17:

  - a decisao vem de `notification_preferences` (par `in_app`), e nao mais das
    duas colunas soltas;
  - `snoozed_until` no futuro suprime a entrega **sem** desligar a preferencia:
    adiar e diferente de recusar, e a distincao precisa sobreviver no dado;
  - `weekly_digest` entra, com janela semanal;
  - `system_notice` **nao e materializado aqui**. Ele existe como tipo entregavel
    e tem preferencia propria, mas nada nesta Stage o gera: um aviso de servico
    nasce de um fato operacional, e nao de um gatilho sobre o comportamento da
    pessoa. Inventar um gerador seria inventar o fato.

  O teto de frequencia continua sendo estrutural, e nao um contador: o unique
  `(user_id, event_key)` impede a segunda entrega da mesma janela, e o
  `on conflict do nothing` transforma a tentativa em nada.
*/
create or replace function public.materialize_in_app_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_day date := current_date;
  current_week text := to_char(current_date, 'IYYY-"W"IW');
  created_id uuid;
  created_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.user_preferences where user_id = current_user_id
  ) then
    raise exception 'preferences not found' using errcode = 'P0002';
  end if;

  -- A matriz pode nao existir para quem foi criado antes desta migration por
  -- um caminho que nao passou pelo trigger. Semear aqui e barato e idempotente.
  perform public.seed_notification_preferences(current_user_id);

  -- Check-in: convite quando ainda nao houve registro hoje.
  if public.notification_channel_delivers(current_user_id, 'checkin_reminder', 'in_app')
    and not exists (
      select 1
      from public.emotional_checkins checkin
      where checkin.user_id = current_user_id
        and (checkin.occurred_at at time zone 'UTC')::date = current_day
    ) then
    created_id := null;
    insert into public.notifications (user_id, kind, event_key)
    values (
      current_user_id,
      'checkin_reminder',
      'checkin_reminder:' || to_char(current_day, 'YYYY-MM-DD')
    )
    on conflict (user_id, event_key) do nothing
    returning id into created_id;

    if created_id is not null then
      created_count := created_count + 1;
      insert into public.audit_logs (
        actor_user_id, action, entity_type, entity_id, outcome, correlation_id
      ) values (
        current_user_id, 'notification.created', 'notification', created_id,
        'success', gen_random_uuid()
      );
    end if;
  end if;

  -- Metas: so faz sentido com meta ativa.
  if public.notification_channel_delivers(current_user_id, 'goal_reminder', 'in_app')
    and exists (
      select 1
      from public.goals goal
      where goal.user_id = current_user_id
        and goal.status = 'active'
    ) then
    created_id := null;
    insert into public.notifications (user_id, kind, event_key)
    values (
      current_user_id,
      'goal_reminder',
      'goal_reminder:' || to_char(current_day, 'YYYY-MM-DD')
    )
    on conflict (user_id, event_key) do nothing
    returning id into created_id;

    if created_id is not null then
      created_count := created_count + 1;
      insert into public.audit_logs (
        actor_user_id, action, entity_type, entity_id, outcome, correlation_id
      ) values (
        current_user_id, 'notification.created', 'notification', created_id,
        'success', gen_random_uuid()
      );
    end if;
  end if;

  -- Resumo da semana: uma janela, uma entrega, e somente para quem pediu.
  if public.notification_channel_delivers(current_user_id, 'weekly_digest', 'in_app') then
    created_id := null;
    insert into public.notifications (user_id, kind, event_key)
    values (current_user_id, 'weekly_digest', 'weekly_digest:' || current_week)
    on conflict (user_id, event_key) do nothing
    returning id into created_id;

    if created_id is not null then
      created_count := created_count + 1;
      insert into public.audit_logs (
        actor_user_id, action, entity_type, entity_id, outcome, correlation_id
      ) values (
        current_user_id, 'notification.created', 'notification', created_id,
        'success', gen_random_uuid()
      );
    end if;
  end if;

  return created_count;
end;
$$;

/*
  A regra de entrega, em um lugar so.

  Habilitado **e** sem adiamento vigente. Espalhar as duas condicoes pelos
  ramos da materializacao garantiria que uma delas fosse esquecida em algum
  caminho - e o caminho esquecido e sempre o que entrega demais.
*/
create or replace function public.notification_channel_delivers(
  p_user_id uuid,
  p_kind text,
  p_channel text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select preference.enabled
        and (preference.snoozed_until is null
             or preference.snoozed_until <= timezone('utc', now()))
      from public.notification_preferences preference
      where preference.user_id = p_user_id
        and preference.kind = p_kind
        and preference.channel = p_channel
    ),
    false
  );
$$;

revoke all on function public.notification_channel_delivers(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.notification_channel_delivers(uuid, text, text)
to service_role;

revoke all on function public.materialize_in_app_notifications()
from public, anon, service_role;
grant execute on function public.materialize_in_app_notifications()
to authenticated;
