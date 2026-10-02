-- ---------------------------------------------------------------------------
-- Stage 22-V - remediacao: cobertura parcial por inicio tardio da analise
--
-- Aditiva, e migration **nova** em vez de edicao da anterior: a
-- `20260905100000` ja esta aplicada e publicada, e reescreve-la faria o mesmo
-- arquivo significar coisas diferentes em ambientes diferentes.
--
-- ## O motivo que faltava
--
-- Carregar 21 MB de WASM e modelo leva segundos, e a sessao nao espera por
-- isso. Numa sessao de 60 s cuja analise visual subiu no segundo 5, os
-- primeiros 5 segundos **nao foram observados por ninguem**. A cobertura
-- precisava de um nome para isso, e nenhum dos existentes serve:
--
--   `interrupted`   - a fonte se perdeu no meio. Aqui ela ainda nao existia.
--   `out_of_frame`  - a fonte estava inteira e a pessoa fora dela. Aqui nao
--                     havia fonte para a pessoa estar dentro ou fora.
--   `not_observed`  - a analise rodou e nao viu nada. Aqui ela nem rodava.
--
-- Sem o nome novo, a unica saida seria declarar `full` - afirmando observacao
-- que nao houve - ou reaproveitar um motivo que descreve outra coisa. As duas
-- opcoes trocam um fato por uma aproximacao conveniente.
-- ---------------------------------------------------------------------------

alter table public.session_modality_coverage
  drop constraint if exists session_modality_coverage_reason_check;
alter table public.session_modality_coverage
  add constraint session_modality_coverage_reason_check
  check (reason is null or reason in (
    'not_requested', 'unsupported', 'denied', 'cancelled', 'error',
    'not_observed',
    'interrupted', 'recording_capped', 'out_of_frame', 'analysis_started_late'
  ));

alter table public.session_modality_coverage
  drop constraint if exists session_modality_coverage_reason_domain;
alter table public.session_modality_coverage
  add constraint session_modality_coverage_reason_domain check (
    outcome = 'full'
    or (outcome = 'partial' and reason in (
      'interrupted', 'recording_capped', 'out_of_frame', 'analysis_started_late'
    ))
    or (outcome = 'absent' and reason in (
      'not_requested', 'unsupported', 'denied', 'cancelled', 'error',
      'not_observed'
    ))
  );
