-- ---------------------------------------------------------------------------
-- Stage 23 / Extensao do Gate 23-A - e-mail como terceiro canal da matriz.
--
-- Migration **aditiva**. Nenhuma linha existente e alterada, nenhuma preferencia
-- e redefinida, e nenhum canal e ligado.
--
-- ## Por que cabe numa migration pequena
--
-- A matriz do 23-A foi desenhada como tabela `(user_id, kind, channel)`
-- justamente para que um canal novo fosse **uma linha**, e nao uma coluna. Esta
-- migration cobra essa promessa: amplia o vocabulario de `channel`, semeia as
-- linhas novas desligadas, e nao toca em mais nada.
--
-- ## A licao do `L-159`, aplicada antes de escrever
--
-- Quando o vocabulario de um `check` muda, e preciso varrer **todas** as
-- constraints que carregam aquele vocabulario. A varredura foi feita: `in_app` e
-- `web_push` aparecem em nomes de funcao (`materialize_in_app_notifications`),
-- em valores dentro da semeadura, em predicados do trigger de sincronia e em
-- asseracoes de teste — mas em **uma unica** constraint. Nao ha segunda regra
-- esquecida esperando recusar o insert em silencio.
--
-- ## O que esta migration deliberadamente NAO faz
--
-- `materialize_in_app_notifications` continua intocada. Ela materializa aviso
-- **in-app**, e passar a criar linha de e-mail ali confundiria dois canais com
-- ciclos de vida diferentes: um aparece na tela quando a pessoa abre o
-- aplicativo, o outro sai da Elyra e chega na caixa de entrada de alguem. A
-- entrega por e-mail tem servico proprio.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. O vocabulario
-- ---------------------------------------------------------------------------

alter table public.notification_preferences
  drop constraint if exists notification_preferences_channel_check;

alter table public.notification_preferences
  add constraint notification_preferences_channel_check
  check (channel in ('in_app', 'web_push', 'email'));

comment on column public.notification_preferences.channel is
  'Caminho de entrega: in_app, web_push ou email. E-mail nasce desligado.';

-- ---------------------------------------------------------------------------
-- 2. Semeadura: as linhas novas nascem desligadas
-- ---------------------------------------------------------------------------

/*
  Quatro linhas novas por pessoa, todas `false` — inclusive `system_notice`.

  No canal in-app o aviso de servico nasce ligado, porque ele apenas espera a
  pessoa abrir o aplicativo. Por e-mail ele **sai** da Elyra e chega num lugar
  que nao e nosso: caixa compartilhada, tela bloqueada, relogio. Interromper
  alguem ali exige pedido, e nao heranca de outro canal.

  O `on conflict do nothing` protege quem ja escolheu: rodar de novo nao
  redefine nada. E o backfill abaixo depende disso para nao apagar decisao.
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
    -- In-app herda a decisao que ja existia (ver 23-A).
    (p_user_id, 'checkin_reminder', 'in_app', coalesce(legacy.checkin_reminder, true)),
    (p_user_id, 'goal_reminder',    'in_app', coalesce(legacy.goal_reminder, true)),
    (p_user_id, 'weekly_digest',    'in_app', false),
    (p_user_id, 'system_notice',    'in_app', true),
    -- Push depende de permissao do navegador e de chave no ambiente.
    (p_user_id, 'checkin_reminder', 'web_push', false),
    (p_user_id, 'goal_reminder',    'web_push', false),
    (p_user_id, 'weekly_digest',    'web_push', false),
    (p_user_id, 'system_notice',    'web_push', false),
    -- E-mail: opt-in integral. Nenhuma excecao, nem para aviso de servico.
    (p_user_id, 'checkin_reminder', 'email', false),
    (p_user_id, 'goal_reminder',    'email', false),
    (p_user_id, 'weekly_digest',    'email', false),
    (p_user_id, 'system_notice',    'email', false)
  on conflict (user_id, kind, channel) do nothing;
end;
$$;

revoke all on function public.seed_notification_preferences(uuid)
from public, anon, authenticated;
grant execute on function public.seed_notification_preferences(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Backfill de quem ja existe
-- ---------------------------------------------------------------------------

/*
  Idempotente pelo `on conflict`: quem ja tem as oito linhas ganha so as quatro
  de e-mail, desligadas, e as escolhas anteriores permanecem exatamente como
  estavam. Nenhuma pessoa passa a receber e-mail por efeito desta migration —
  que e a regra `EMAIL_ENGAGEMENT_DEFAULT = OFF`, imposta pelo dado e nao pela
  intencao.
*/
select public.seed_notification_preferences(user_id)
from public.user_preferences;
