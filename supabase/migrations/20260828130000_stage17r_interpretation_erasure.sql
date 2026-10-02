-- Stage 17-R: o direito ao apagamento vence a imutabilidade da interpretacao.
--
-- Defeito corrigido aqui, descoberto pelo harness `qa:stage17r`:
--
--   Com uma linha real em `session_interpretations`, a exclusao de conta ficava
--   IMPOSSIVEL. `finalize_account_deletion` termina em
--   `delete from auth.users`, que cascateia por `profiles` e
--   `multimodal_sessions` ate `session_interpretations`. O trigger
--   `session_interpretations_reject_update` era `before update OR DELETE` e
--   levantava excecao incondicionalmente, abortando a transacao inteira.
--   Resultado observado: `Database error deleting user`, usuario preservado e
--   interpretacao preservada — ou seja, o titular perdia o direito de apagar os
--   proprios dados (ADR-0006, Stage 14).
--
-- Por que isso passou despercebido ate agora: ate a Stage 17-R nenhuma linha do
-- produto escrevia nessa tabela. Ela estava sempre vazia, entao a cascata nunca
-- encontrava linha para recusar. O defeito nasceu na Stage 12 e so se tornou
-- ALCANCAVEL quando o writer real passou a existir.
--
-- A correcao respeita a intencao original, que o proprio comentario da Stage 12
-- declarava: "interpretacao e append-only: nunca editada, nunca apagada
-- **pelo dono**". Apagar pelo dono continua impossivel — e continua impossivel
-- por duas camadas que nao dependem deste trigger:
--
--   1. privilegio: `authenticated` tem apenas `select, insert`;
--   2. RLS: nao existe policy de `delete` nem de `update`, e a tabela esta em
--      `force row level security`, entao o default deny se aplica.
--
-- O que muda e so isto: a cascata de exclusao do titular deixa de ser recusada.
-- Nenhum caminho novo de escrita, edicao ou leitura e aberto.

-- Recusa passa a valer para UPDATE apenas. DELETE fica com privilegio e RLS.
drop trigger if exists session_interpretations_reject_update
on public.session_interpretations;

create trigger session_interpretations_reject_update
before update on public.session_interpretations
for each row execute function public.reject_session_interpretation_mutation();

comment on function public.reject_session_interpretation_mutation() is
  'Stage 17-R: bloqueia UPDATE em session_interpretations. DELETE nao passa por '
  'aqui de proposito — o dono ja e bloqueado por privilegio e por ausencia de '
  'policy, e a cascata do direito ao apagamento precisa concluir.';

comment on table public.session_interpretations is
  'Saida PedroCore, imutavel para o dono e removivel apenas pela cascata de '
  'exclusao do titular (ADR-0006).';
