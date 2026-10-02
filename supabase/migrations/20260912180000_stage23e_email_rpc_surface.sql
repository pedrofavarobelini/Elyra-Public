-- ---------------------------------------------------------------------------
-- Stage 23 / Gate 23-E - reducao de superficie das RPCs de entrega de e-mail.
--
-- Migration **aditiva** em efeito: nenhuma tabela, coluna, policy ou dado muda.
-- O que muda e **quem pode executar** duas funcoes.
--
-- ## O finding (F-23E-01)
--
-- `enqueue_notification_email` e `settle_notification_email` nasceram com
-- `grant execute ... to authenticated`, e a primeira recebe `p_subject` e
-- `p_body` **do chamador**.
--
-- Consequencia: a regra "nenhum conteudo sensivel em e-mail" passava a valer
-- apenas nos templates em TypeScript, e nao na fronteira de confianca. Uma
-- pessoa autenticada podia gravar na propria linha de auditoria um conteudo que
-- o sistema nunca enviou — e, com transporte real configurado, pedir o envio
-- desse conteudo para si mesma.
--
-- E autodirigido: a RLS chaveia por `auth.uid()`, entao nao ha alcance sobre
-- outra pessoa. Por isso MEDIUM, e nao HIGH. Mas a garantia estava no lugar
-- errado.
--
-- ## Por que restringir e barato, e por que e o papel certo
--
-- Verificado antes de mexer: **nada chama** `sendNotificationEmail` hoje — nem
-- rota, nem action, nem agendador. A capability existia sem consumidor.
--
-- E entrega de engajamento e acao **iniciada pelo sistema**, e nao pela pessoa:
-- quem decide enviar o resumo semanal e um agendador que age por muitos
-- titulares, fora de qualquer sessao. `service_role` nao e restricao excessiva
-- aqui — e o papel que corresponde a natureza da operacao.
--
-- O dia em que o agendador existir, ele ja encontra a superficie no tamanho
-- certo, em vez de herdar uma porta aberta que ninguem lembrava de fechar.
-- ---------------------------------------------------------------------------

revoke execute on function public.enqueue_notification_email(text, text, text, text, text)
from authenticated;

revoke execute on function public.settle_notification_email(uuid, boolean, text)
from authenticated;

grant execute on function public.enqueue_notification_email(text, text, text, text, text)
to service_role;

grant execute on function public.settle_notification_email(uuid, boolean, text)
to service_role;

/*
  A leitura continua sendo do titular.

  `email_deliveries` mantem `select` owner-only: a pessoa nao pode mais pedir um
  envio, e continua podendo ver o que lhe foi enviado. Tirar a leitura junto
  transformaria uma reducao de superficie em perda de transparencia.
*/
