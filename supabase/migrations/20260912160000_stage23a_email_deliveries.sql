-- ---------------------------------------------------------------------------
-- Stage 23 / Extensao 23-A - entrega de e-mail de engajamento.
--
-- Migration **aditiva**. Nenhuma tabela existente e alterada.
--
-- ## Idempotencia estrutural, e nao contador
--
-- O 23-A resolveu "uma entrega por janela" com `unique (user_id, event_key)` em
-- `notifications`, e nao com um contador que alguem precisa lembrar de
-- consultar. Aqui vale o mesmo: a segunda tentativa da mesma notificacao logica
-- colide com o indice e vira nada. Retry, timeout, reprocessamento e duplo
-- worker convergem para uma linha so — porque a garantia esta no dado, e nao na
-- disciplina de quem chama.
--
-- ## Preferencia e adiamento vivem onde ja viviam
--
-- A RPC abaixo consulta `notification_channel_delivers`, a **mesma** funcao que
-- o in-app usa. Uma segunda implementacao da pergunta "esta pessoa quer isto,
-- por este caminho, agora?" divergiria da primeira no primeiro caso de borda — e
-- o caso de borda aqui manda e-mail para quem pediu silencio.
-- ---------------------------------------------------------------------------

create table if not exists public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  kind text not null check (
    kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice')
  ),
  /*
    A janela vive na chave, como em `notifications`: lembrete e diario, digest e
    semanal. O teto de frequencia e consequencia do formato mais o unique — e
    nao uma regra separada que pode ser esquecida.
  */
  event_key text not null check (
    event_key ~ '^(checkin_reminder|goal_reminder|system_notice):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or event_key ~ '^weekly_digest:[0-9]{4}-W[0-9]{2}$'
  ),
  transport text not null check (transport in ('local_capture', 'brevo')),
  status text not null default 'pending' check (
    status in ('pending', 'captured', 'sent', 'failed')
  ),
  subject text not null check (char_length(btrim(subject)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  attempts smallint not null default 0 check (attempts between 0 and 20),
  failure_code text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  delivered_at timestamptz,
  -- Uma entrega por janela. Esta linha e o teto de frequencia.
  constraint email_deliveries_event_unique unique (user_id, event_key),
  constraint email_delivery_kind_matches_event check (
    split_part(event_key, ':', 1) = kind
  ),
  constraint email_delivery_completion_shape check (
    (status in ('captured', 'sent') and delivered_at is not null)
    or (status in ('pending', 'failed') and delivered_at is null)
  )
);

comment on table public.email_deliveries is
  'E-mail de engajamento enviado ou capturado. Uma linha por janela, imposta por unique.';
comment on column public.email_deliveries.body is
  'Convite, nunca conteudo: sem diario, transcricao, sinal ou interpretacao.';

create index if not exists email_deliveries_user_time_idx
  on public.email_deliveries (user_id, created_at desc);

create trigger email_deliveries_set_updated_at
before update on public.email_deliveries
for each row execute function public.set_updated_at();

alter table public.email_deliveries enable row level security;
alter table public.email_deliveries force row level security;

revoke all on table public.email_deliveries from anon, authenticated;
/*
  Somente leitura da propria linha: a pessoa tem direito de auditar o que lhe foi
  enviado. Escrita e privilegio da RPC — se `authenticated` pudesse inserir aqui,
  qualquer um forjaria a propria entrega e o teto de frequencia deixaria de valer.
*/
grant select on table public.email_deliveries to authenticated;
grant all on table public.email_deliveries to service_role;

create policy email_deliveries_select_own
on public.email_deliveries for select to authenticated
using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Enfileirar: preferencia, adiamento e teto, num lugar so
-- ---------------------------------------------------------------------------

/*
  Devolve o `id` quando a entrega foi criada, e `null` quando **nao deve
  acontecer** — desligado, adiado, ou ja entregue naquela janela.

  `null` nao e erro. Distinguir os tres casos no retorno seria util para log e
  perigoso para o chamador: alguem acabaria tratando "adiado" como falha e
  tentando de novo.
*/
create or replace function public.enqueue_notification_email(
  p_kind text,
  p_event_key text,
  p_transport text,
  p_subject text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  created_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- A mesma pergunta que o in-app faz, pela mesma funcao.
  if not public.notification_channel_delivers(current_user_id, p_kind, 'email') then
    return null;
  end if;

  insert into public.email_deliveries (
    user_id, kind, event_key, transport, subject, body
  ) values (
    current_user_id, p_kind, p_event_key, p_transport, p_subject, p_body
  )
  on conflict (user_id, event_key) do nothing
  returning id into created_id;

  return created_id;
end;
$$;

revoke all on function public.enqueue_notification_email(text, text, text, text, text)
from public, anon, service_role;
grant execute on function public.enqueue_notification_email(text, text, text, text, text)
to authenticated;

-- ---------------------------------------------------------------------------
-- Desfecho da tentativa
-- ---------------------------------------------------------------------------

/*
  Falha de transporte **nao** marca entrega.

  Sem isto, um erro de rede deixaria a linha em `pending` para sempre ou, pior,
  como entregue — e a proxima janela recusaria uma segunda tentativa legitima
  por causa do unique. `failed` mantem `delivered_at` nulo, e o retry da mesma
  janela reaproveita a linha em vez de criar outra.
*/
create or replace function public.settle_notification_email(
  p_delivery_id uuid,
  p_succeeded boolean,
  p_failure_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  update public.email_deliveries
  set
    status = case when p_succeeded then 'captured' else 'failed' end,
    delivered_at = case when p_succeeded then timezone('utc', now()) else null end,
    failure_code = case when p_succeeded then null else p_failure_code end,
    attempts = attempts + 1
  where id = p_delivery_id
    and user_id = current_user_id;
end;
$$;

revoke all on function public.settle_notification_email(uuid, boolean, text)
from public, anon, service_role;
grant execute on function public.settle_notification_email(uuid, boolean, text)
to authenticated;
