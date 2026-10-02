/**
 * Progresso do encerramento de sessao ("Finalizar sessao").
 *
 * **O percentual e derivado de marcos, e nunca do relogio.** Cada etapa do
 * plano so conta quando o codigo que a executa terminou de verdade; o tempo
 * decorrido e mostrado ao lado, mas nao move a barra. Um temporizador que
 * enchesse a barra ensinaria a pessoa a confiar num numero que nao mede nada.
 *
 * As etapas espelham o caminho real de `finishSession` na tela de captura:
 * parar coletores, consolidar a transcricao local, consolidar os sinais,
 * encerrar gravacoes (e enviar, so com `keepRecording`), salvar a sessao e
 * submeter a analise - que atravessa o Veltrix apenas com consentimento de IA.
 * Etapa que nao existe para a sessao nao entra no plano, e por isso nunca e
 * esperada.
 */

export type FinalizationStep =
  | "stopping_capture"
  | "consolidating_transcript"
  | "consolidating_signals"
  | "stopping_recording"
  | "uploading_recording"
  | "saving_session"
  | "analyzing"
  | "saving_analysis";

export interface FinalizationPlanOptions {
  transcribe: boolean;
  keepRecording: boolean;
  aiAnalysis: boolean;
  /** Ha ao menos uma modalidade capturada; sem ela nao existe analise a enviar. */
  hasCapture: boolean;
}

export interface FinalizationProgress {
  steps: readonly FinalizationStep[];
  /** Etapa em andamento. `steps.length` significa concluido. */
  index: number;
  startedAt: number;
  stepStartedAt: number;
}

/**
 * Peso de cada etapa no percentual.
 *
 * Os pesos so decidem o tamanho do salto quando um marco real acontece; eles
 * nao preveem duracao. As etapas pesadas sao as que, no aparelho, de fato
 * demoram: o fechamento do Whisper local e o processamento no servidor.
 */
const STEP_WEIGHT: Record<FinalizationStep, number> = {
  stopping_capture: 5,
  consolidating_transcript: 30,
  consolidating_signals: 5,
  stopping_recording: 5,
  uploading_recording: 15,
  saving_session: 5,
  analyzing: 45,
  saving_analysis: 15,
};

export const FINALIZATION_STEP_LABEL: Record<FinalizationStep, string> = {
  stopping_capture: "Encerrando a captura",
  consolidating_transcript: "Consolidando a transcrição local",
  consolidating_signals: "Consolidando os sinais da sessão",
  stopping_recording: "Encerrando a gravação e liberando os dispositivos",
  uploading_recording: "Enviando as gravações autorizadas",
  saving_session: "Salvando a sessão",
  analyzing: "Analisando a sessão",
  saving_analysis: "Salvando a análise da sessão",
};

export const FINALIZATION_DONE_LABEL = "Sessão finalizada";

/**
 * A partir de quanto tempo parada numa etapa a tela avisa da demora.
 *
 * O aviso **nao cancela nada**: a etapa continua valida, e um timeout
 * agressivo aqui derrubaria uma analise que so estava lenta.
 */
const STALL_AFTER_MS: Record<FinalizationStep, number> = {
  stopping_capture: 20_000,
  consolidating_transcript: 45_000,
  consolidating_signals: 20_000,
  stopping_recording: 20_000,
  uploading_recording: 60_000,
  saving_session: 20_000,
  analyzing: 60_000,
  saving_analysis: 30_000,
};

export function finalizationPlan(options: FinalizationPlanOptions): FinalizationStep[] {
  const steps: FinalizationStep[] = ["stopping_capture"];
  if (options.transcribe) steps.push("consolidating_transcript");
  if (options.hasCapture) steps.push("consolidating_signals");
  steps.push("stopping_recording");
  if (options.keepRecording && options.hasCapture) steps.push("uploading_recording");
  steps.push("saving_session");
  if (options.hasCapture) steps.push(options.aiAnalysis ? "analyzing" : "saving_analysis");
  return steps;
}

export function createFinalization(
  options: FinalizationPlanOptions,
  now: number,
): FinalizationProgress {
  return { steps: finalizationPlan(options), index: 0, startedAt: now, stepStartedAt: now };
}

/**
 * Marca o inicio de `step`, e com isso a conclusao de todas as anteriores.
 *
 * So avanca: etapa ja passada, etapa fora do plano ou progresso concluido
 * devolvem o mesmo estado. E isso que torna o percentual monotonico.
 */
export function advanceFinalization(
  state: FinalizationProgress,
  step: FinalizationStep,
  now: number,
): FinalizationProgress {
  const target = state.steps.indexOf(step);
  if (target <= state.index) return state;
  return { ...state, index: target, stepStartedAt: now };
}

/** Unico caminho para 100%: chamado depois de a ultima etapa terminar de fato. */
export function completeFinalization(
  state: FinalizationProgress,
  now: number,
): FinalizationProgress {
  if (finalizationDone(state)) return state;
  return { ...state, index: state.steps.length, stepStartedAt: now };
}

export function finalizationDone(state: FinalizationProgress): boolean {
  return state.index >= state.steps.length;
}

export function finalizationPercent(state: FinalizationProgress): number {
  if (finalizationDone(state)) return 100;
  const total = state.steps.reduce((sum, step) => sum + STEP_WEIGHT[step], 0);
  const completed = state.steps
    .slice(0, state.index)
    .reduce((sum, step) => sum + STEP_WEIGHT[step], 0);
  // Antes da conclusao o teto e 99: arredondar para 100 anunciaria um fim
  // que ainda nao aconteceu.
  return Math.min(99, Math.floor((completed / total) * 100));
}

export function finalizationCurrentStep(
  state: FinalizationProgress,
): FinalizationStep | null {
  return finalizationDone(state) ? null : (state.steps[state.index] ?? null);
}

export function finalizationLabel(state: FinalizationProgress): string {
  const step = finalizationCurrentStep(state);
  return step ? FINALIZATION_STEP_LABEL[step] : FINALIZATION_DONE_LABEL;
}

export function finalizationElapsedSeconds(state: FinalizationProgress, now: number): number {
  return Math.max(0, Math.floor((now - state.startedAt) / 1000));
}

export function finalizationStalled(state: FinalizationProgress, now: number): boolean {
  const step = finalizationCurrentStep(state);
  return step !== null && now - state.stepStartedAt > STALL_AFTER_MS[step];
}
