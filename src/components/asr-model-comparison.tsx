"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ASR_AB_FIXTURE_BLOCKS,
  ASR_AB_FIXTURE_VERSION,
  ASR_AB_REFERENCE,
} from "@/lib/qa/asr-ab-fixture";
import { asrAbComparisonFlagEnabled } from "@/lib/qa/asr-ab-mode";
import { buildAsrAbReport, type AsrAbReport } from "@/lib/qa/asr-ab-report";
import { startBrowserPcmCollection } from "@/lib/speech/browser-audio";
import {
  ASR_MODEL_BYTES,
  ASR_MODEL_ID,
  ASR_QA_COMPARATOR_MODEL_ID,
  type AsrModelId,
  asrAssetsPresent,
  loadAsrSession,
  loadVadSession,
} from "@/lib/speech/browser-runtime";
import {
  compareAsrModels,
  type AsrLoadAttempt,
  type AsrModelVariant,
} from "@/lib/speech/model-comparison";
import {
  classifyBrokenLink,
  memoryMeasurementAvailable,
  sampleMemory,
  type BrokenLink,
  type LoadEvent,
} from "@/lib/qa/asr-load-forensics";
import type { PcmCollector } from "@/lib/speech/audio-pipeline";



type Phase =
  | "idle"
  | "checking"
  | "ready"
  | "recording"
  | "comparing"
  | "done"
  | "blocked";


const MODEL_LABEL: Readonly<Record<AsrModelId, string>> = {
  "onnx-community/whisper-base": "Base q8",
  "onnx-community/whisper-small": "Small q8",
};

/*
  `AsrModelId`, e nao `string`.

  Com a chave tipada nao ha `?? 0` nem `?? id`: um modelo desconhecido vira erro
  de compilacao, e nao um rotulo cru com "0 MB" ao lado numa tela que anuncia
  download.
*/
function variant(id: AsrModelId): AsrModelVariant {
  return { id, label: MODEL_LABEL[id], approxBytes: ASR_MODEL_BYTES[id] };
}

/** Comparador primeiro, produto depois — a mesma ordem do A/B fisico. */
const COMPARATOR = variant(ASR_QA_COMPARATOR_MODEL_ID);
const DEFAULT_MODEL = variant(ASR_MODEL_ID);
const VARIANTS: readonly AsrModelVariant[] = [COMPARATOR, DEFAULT_MODEL];

const VOTES = [
  { id: "base", label: "Base melhor" },
  { id: "small", label: "Small melhor" },
  { id: "similar", label: "Qualidade semelhante" },
  { id: "neither", label: "Nenhum aceitável" },
] as const;

type Vote = (typeof VOTES)[number]["id"];

function megabytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

function rate(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

function milliseconds(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

/**
 * Carrega um modelo guardando **onde** parou.
 *
 * Usada pelo A/B e pelo preflight, de proposito: se o preflight carregasse por
 * um caminho proprio, ele poderia passar enquanto o A/B falha, e o diagnostico
 * valeria para um caminho que ninguem usa.
 */
async function attemptLoad(modelId: string): Promise<AsrLoadAttempt> {
  const events: LoadEvent[] = [];
  const load = await loadAsrSession({
    modelId,
    onLoadEvent: (event) => events.push(event),
  });
  return {
    session: load.value,
    failure: load.failure,
    errorName: load.detail?.errorName ?? null,
    errorMessage: load.detail?.errorMessage ?? null,
    events,
  };
}

function heapLabel(value: number | null): string {
  // `null` e ausencia de medicao, e nao zero de memoria.
  return value === null ? "não medido" : megabytes(value);
}

interface PreflightResult {
  mode: "solo" | "after_base";
  loaded: boolean;
  brokenLink: BrokenLink | null;
  failure: string | null;
  errorName: string | null;
  errorMessage: string | null;
  filesCompleted: string[];
  lastCompletedFile: string | null;
  eventCount: number;
  elapsedMs: number;
  /** `null` no modo `solo`, onde o base nem e carregado. */
  baseLoaded: boolean | null;
  heapStart: number | null;
  heapAfterBaseDisposed: number | null;
  heapBeforeSmall: number | null;
  heapAfter: number | null;
  memoryMeasurementAvailable: boolean;
  /**
   * O teto de heap deste aparelho, e a RAM que ele declara.
   *
   * Sem o teto, um pico de 400 MB e um numero sem escala. Com ele, a pergunta
   * "faltou memoria?" vira aritmetica em vez de opiniao.
   */
  heapLimitBytes: number | null;
  deviceMemoryGb: number | null;
  pageWasReloaded: boolean;
}

/**
 * Esta carga da pagina foi um recarregamento?
 *
 * Sinal de aba que morreu: o Chrome do Android recarrega a aba sozinho depois
 * de matar o renderizador por pressao de memoria, e do lado do JavaScript isso
 * e indistinguivel de um F5 — mas e a unica pista que sobra de um crash.
 *
 * Usa a Navigation Timing, e nao `sessionStorage`: guardar estado aqui abriria
 * uma porta que a arvore de A/B nao deve ter, e ha um teste que reprova se ela
 * abrir.
 */
function pageWasReloaded(): boolean {
  try {
    const entry = performance.getEntriesByType("navigation")[0] as
      | { type?: string }
      | undefined;
    return entry?.type === "reload";
  } catch {
    return false;
  }
}

const BROKEN_LINK_LABEL: Record<string, string> = {
  asset_fetch: "os arquivos não desceram",
  asset_integrity: "os arquivos desceram corrompidos",
  runtime_init: "o runtime WASM não subiu",
  encoder_load: "quebrou no encoder",
  decoder_load: "quebrou no decoder",
  memory_allocation: "faltou memória",
  unknown: "causa não determinada",
};

export function AsrModelComparison() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [report, setReport] = useState<AsrAbReport | null>(null);
  const [vote, setVote] = useState<Vote | null>(null);
  const [copied, setCopied] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightRunning, setPreflightRunning] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const collectorRef = useRef<PcmCollector | null>(null);

  const totalBytes = useMemo(
    () => VARIANTS.reduce((sum, variant) => sum + variant.approxBytes, 0),
    [],
  );

  const prepare = useCallback(async () => {
    setPhase("checking");
    setMessage(null);
    const missing: string[] = [];
    for (const variant of VARIANTS) {
      if (!(await asrAssetsPresent(variant.id))) missing.push(variant.label);
    }
    if (missing.length > 0) {
      setPhase("blocked");
      setMessage(
        `Ativos ausentes no servidor: ${missing.join(", ")}. Rode \`npm run asr:assets -- --comparator\` antes de comparar.`,
      );
      return;
    }
    setPhase("ready");
  }, []);

  /**
   * Carrega o `small` sem microfone, e diz onde parou.
   *
   * Duas variantes, e a diferenca entre elas **e** o diagnostico:
   *
   *  - `solo`: aba limpa, so o `small`. Se falhar aqui, o problema e o modelo
   *    ou o aparelho — nao a sequencia.
   *  - `after_base`: carrega o `base`, descarta, e so entao tenta o `small`.
   *    E exatamente a sequencia do A/B. Se falhar so aqui, o descarte do `base`
   *    nao devolveu o que prometeu, e o alvo da correcao e o vazamento.
   *
   * Nenhuma das duas liga microfone, transcreve ou persiste nada.
   */
  const runPreflight = useCallback(async (mode: "solo" | "after_base") => {
    setPreflightRunning(mode);
    setPreflight(null);
    setMessage(null);

    const heapStart = sampleMemory().usedHeapBytes;
    let heapAfterBaseDisposed: number | null = null;
    let baseLoaded: boolean | null = null;

    if (mode === "after_base") {
      const base = await attemptLoad(ASR_QA_COMPARATOR_MODEL_ID);
      baseLoaded = base.session !== null;
      if (base.session) {
        try {
          await base.session.dispose?.();
        } catch {
          /* Descarte que falha e informacao, e nao motivo para abortar. */
        }
      }
      /*
        Uma volta ao event loop antes de medir.

        O `dispose` do `transformers.js` e assincrono e o coletor de lixo do V8
        nao roda a pedido. Medir no mesmo tick devolveria o heap de antes e
        faria um descarte correto parecer vazamento.
      */
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      heapAfterBaseDisposed = sampleMemory().usedHeapBytes;
    }

    const heapBeforeSmall = sampleMemory().usedHeapBytes;
    const started = performance.now();
    let attempt: AsrLoadAttempt;
    try {
      attempt = await attemptLoad(ASR_MODEL_ID);
    } catch (error) {
      attempt = {
        session: null,
        failure: "load_threw",
        errorName: error instanceof Error ? error.name : null,
        errorMessage: error instanceof Error ? error.message : String(error),
        events: [],
      };
    }
    const elapsedMs = Math.round(performance.now() - started);
    const finalSample = sampleMemory();
    const heapAfter = finalSample.usedHeapBytes;
    const completed = attempt.events.filter((event) => event.status === "done");

    if (attempt.session) {
      try {
        await attempt.session.dispose?.();
      } catch {
        /* Ja medimos o que interessava. */
      }
    }

    setPreflight({
      mode,
      loaded: attempt.session !== null,
      brokenLink: attempt.session
        ? null
        : classifyBrokenLink({
            events: attempt.events,
            errorName: attempt.errorName,
            errorMessage: attempt.errorMessage,
          }),
      failure: attempt.failure,
      errorName: attempt.errorName,
      errorMessage: attempt.errorMessage,
      filesCompleted: completed.map((event) => event.file),
      lastCompletedFile: completed.length > 0 ? completed[completed.length - 1]!.file : null,
      eventCount: attempt.events.length,
      elapsedMs,
      baseLoaded,
      heapStart,
      heapAfterBaseDisposed,
      heapBeforeSmall,
      heapAfter,
      memoryMeasurementAvailable: memoryMeasurementAvailable(),
      heapLimitBytes: finalSample.heapLimitBytes,
      deviceMemoryGb: finalSample.deviceMemoryGb,
      pageWasReloaded: pageWasReloaded(),
    });
    setPreflightRunning(null);
  }, []);

  const startRecording = useCallback(async () => {
    setMessage(null);
    setReport(null);
    setVote(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      collectorRef.current = startBrowserPcmCollection(stream);
      if (collectorRef.current.available === false) {
        setPhase("blocked");
        setMessage("Este navegador não permitiu criar o grafo de áudio.");
        return;
      }
      setPhase("recording");
    } catch {
      setPhase("blocked");
      setMessage("Permissão de microfone negada, ou nenhum microfone disponível.");
    }
  }, []);

  const stopAndCompare = useCallback(async () => {
    const collector = collectorRef.current;
    const stream = streamRef.current;
    collectorRef.current = null;
    streamRef.current = null;

    const pcm = collector?.stop() ?? new Float32Array(0);
    stream?.getTracks().forEach((track) => track.stop());

    if (pcm.length === 0) {
      setPhase("blocked");
      setMessage("Nenhuma amostra de áudio foi capturada.");
      return;
    }

    setPhase("comparing");
    setStage("Carregando o detector de fala");

    const vad = await loadVadSession();
    if (!vad.value) {
      setPhase("blocked");
      setMessage(`O VAD não carregou (${vad.failure}). Sem VAD não há comparação.`);
      return;
    }

    try {
      const comparison = await compareAsrModels({
        pcm,
        vad: vad.value,
        variants: VARIANTS,
        onStage: ({ modelId, phase: step }) => {
          const label = VARIANTS.find((variant) => variant.id === modelId)?.label ?? modelId;
          setStage(
            step === "loading"
              ? `Carregando ${label}`
              : step === "transcribing"
                ? `Transcrevendo com ${label}`
                : `${label} concluído`,
          );
        },
        load: (modelId) => attemptLoad(modelId),
      });
      setReport(buildAsrAbReport(comparison, ASR_AB_REFERENCE, ASR_AB_FIXTURE_VERSION));
      setPhase("done");
    } finally {
      setStage(null);
      await vad.value.dispose?.();
    }
  }, []);

  const copyPreflight = useCallback(async () => {
    if (!preflight) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(preflight, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setMessage("O navegador não liberou a área de transferência.");
    }
  }, [preflight]);

  const copyResult = useCallback(async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify({ ...report, humanVote: vote }, null, 2),
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setMessage("O navegador não liberou a área de transferência.");
    }
  }, [report, vote]);

  /*
    O componente se recusa a rodar sem o flag.

    A autoridade e a rota, no servidor — mas um componente montado por engano
    fora do fluxo de QA nao deve baixar 251,8 MB por conta propria.

    A checagem fica **depois** dos hooks, e nao antes: um `return` antecipado
    acima deles mudaria a quantidade de hooks entre renders, que e exatamente o
    que as regras de hooks proibem.
  */
  if (!asrAbComparisonFlagEnabled()) {
    return (
      <p className="text-sm text-ink-muted">
        Comparação de modelos indisponível neste ambiente.
      </p>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-ink">Comparar modelos de transcrição</h1>
          <Badge tone="attention">QA</Badge>
        </div>
        <p className="text-sm text-ink-muted">
          Mesma voz, mesmo áudio, mesmo recorte de fala, mesmos parâmetros. A única
          diferença é o modelo. Nada sai deste aparelho.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>O que dizer</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {ASR_AB_FIXTURE_BLOCKS.map((block) => (
            <div key={block.id} className="flex flex-col gap-1">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                {block.instruction}
              </p>
              {block.reference === "" ? (
                <p className="text-sm italic text-ink-muted">(silêncio)</p>
              ) : (
                <p className="text-sm text-ink">{block.reference}</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Diagnostico de carga do modelo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">
            So carrega o modelo e diz <strong>onde parou</strong>. Nao liga o
            microfone, nao transcreve, nao grava nada.
          </p>
          <p className="text-sm text-ink-muted">
            As duas variantes respondem perguntas diferentes:{" "}
            <em>sozinho</em> testa se o {DEFAULT_MODEL.label} cabe neste
            aparelho; <em>depois do {COMPARATOR.label}</em> repete a sequencia
            exata do A/B. Se so a segunda falhar, o problema e o descarte do{" "}
            {COMPARATOR.label}, e nao o {DEFAULT_MODEL.label}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={preflightRunning !== null}
              onClick={() => runPreflight("solo")}
            >
              {preflightRunning === "solo"
                ? "Carregando..."
                : `${DEFAULT_MODEL.label} sozinho`}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={preflightRunning !== null}
              onClick={() => runPreflight("after_base")}
            >
              {preflightRunning === "after_base"
                ? "Carregando..."
                : `${COMPARATOR.label}, descarte, ${DEFAULT_MODEL.label}`}
            </Button>
          </div>

          {preflight && (
            <div className="flex flex-col gap-2 rounded-control bg-surface-muted p-3 text-sm">
              <p className="font-medium text-ink">
                {preflight.loaded
                  ? `O ${DEFAULT_MODEL.label} carregou.`
                  : `Quebrou: ${BROKEN_LINK_LABEL[preflight.brokenLink ?? "unknown"]}`}
              </p>
              <div className="grid grid-cols-2 gap-1">
                <span className="text-ink-muted">SMALL_FIRST_BROKEN_LINK</span>
                <span className="text-ink">{preflight.brokenLink ?? "-"}</span>
                <span className="text-ink-muted">Ultimo arquivo inteiro</span>
                <span className="break-all text-ink">
                  {preflight.lastCompletedFile ?? "nenhum"}
                </span>
                <span className="text-ink-muted">Arquivos concluidos</span>
                <span className="text-ink">{preflight.filesCompleted.length}</span>
                <span className="text-ink-muted">Eventos do runtime</span>
                <span className="text-ink">{preflight.eventCount}</span>
                <span className="text-ink-muted">Tempo</span>
                <span className="text-ink">{milliseconds(preflight.elapsedMs)}</span>
                {preflight.mode === "after_base" && (
                  <>
                    <span className="text-ink-muted">{COMPARATOR.label} carregou</span>
                    <span className="text-ink">
                      {preflight.baseLoaded ? "sim" : "nao"}
                    </span>
                  </>
                )}
                <span className="text-ink-muted">Aba recarregou</span>
                <span className="text-ink">
                  {preflight.pageWasReloaded ? "sim" : "nao"}
                </span>
              </div>

              {preflight.errorMessage && (
                <p className="break-all text-xs text-destructive">
                  {preflight.errorName}: {preflight.errorMessage}
                </p>
              )}

              <div className="grid grid-cols-2 gap-1 border-t border-line-strong pt-2">
                <span className="text-ink-muted">Heap no inicio</span>
                <span className="text-ink">{heapLabel(preflight.heapStart)}</span>
                {preflight.mode === "after_base" && (
                  <>
                    <span className="text-ink-muted">
                      Heap apos descartar o {COMPARATOR.label}
                    </span>
                    <span className="text-ink">
                      {heapLabel(preflight.heapAfterBaseDisposed)}
                    </span>
                  </>
                )}
                <span className="text-ink-muted">
                  Heap antes do {DEFAULT_MODEL.label}
                </span>
                <span className="text-ink">{heapLabel(preflight.heapBeforeSmall)}</span>
                <span className="text-ink-muted">Heap no fim</span>
                <span className="text-ink">{heapLabel(preflight.heapAfter)}</span>
                <span className="text-ink-muted">Teto de heap do aparelho</span>
                <span className="text-ink">{heapLabel(preflight.heapLimitBytes)}</span>
                <span className="text-ink-muted">RAM declarada</span>
                <span className="text-ink">
                  {preflight.deviceMemoryGb === null
                    ? "não informada"
                    : `${preflight.deviceMemoryGb} GB`}
                </span>
              </div>
              <p className="text-xs text-ink-muted">
                {preflight.memoryMeasurementAvailable
                  ? "O heap medido e so o de JavaScript. Os pesos do ONNX vivem na memoria do WASM, que esta API nao enxerga - um numero modesto aqui nao prova que havia memoria sobrando."
                  : "MEMORY_MEASUREMENT_AVAILABLE=NO - este navegador nao expoe a medicao. Ausencia, nao zero."}
              </p>
              <Button
                variant="soft"
                size="sm"
                className="self-start"
                onClick={copyPreflight}
              >
                {copied ? "Copiado" : "Copiar diagnostico"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {phase === "idle" && (
        <Card>
          <CardHeader>
            <CardTitle>
              Preparar comparação {COMPARATOR.label} × {DEFAULT_MODEL.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-ink-muted">
              São dois modelos, carregados um de cada vez:{" "}
              {VARIANTS.map((variant) => `${variant.label} ${megabytes(variant.approxBytes)}`).join(
                " e ",
              )}
              . No total, <strong>{megabytes(totalBytes)}</strong> descem para este
              aparelho. Em rede móvel isso é caro — prefira Wi-Fi.
            </p>
            <Button onClick={prepare} className="self-start">
              Verificar e preparar
            </Button>
          </CardContent>
        </Card>
      )}

      {phase === "checking" && <p className="text-sm text-ink-muted">Verificando ativos…</p>}

      {phase === "ready" && (
        <Card>
          <CardHeader>
            <CardTitle>Pronto para gravar</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-ink-muted">
              Grave uma única vez. Os dois modelos vão receber exatamente este áudio.
            </p>
            <Button onClick={startRecording} className="self-start">
              Começar a gravar
            </Button>
          </CardContent>
        </Card>
      )}

      {phase === "recording" && (
        <Card>
          <CardHeader>
            <CardTitle>Gravando</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-ink-muted">
              Leia o primeiro bloco, faça o silêncio de 8 a 10 segundos, leia o
              segundo bloco. Depois pare.
            </p>
            <Button variant="destructive" onClick={stopAndCompare} className="self-start">
              Parar e comparar
            </Button>
          </CardContent>
        </Card>
      )}

      {phase === "comparing" && (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-6">
            <p className="text-sm font-medium text-ink">Comparando…</p>
            <p className="text-sm text-ink-muted">{stage ?? "Preparando"}</p>
            <p className="text-xs text-ink-muted">
              Um modelo de cada vez, de propósito: os dois juntos na memória
              derrubariam a aba.
            </p>
          </CardContent>
        </Card>
      )}

      {message && (
        <p className="rounded-control bg-destructive-soft p-3 text-sm text-destructive">
          {message}
        </p>
      )}

      {report && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Integridade do experimento</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 text-sm">
              <span className="text-ink-muted">Execuções do VAD</span>
              <span className="text-ink">{report.vadRuns}</span>
              <span className="text-ink-muted">Trechos de fala</span>
              <span className="text-ink">{report.candidateCount}</span>
              <span className="text-ink-muted">Modelos simultâneos (pico)</span>
              <span className="text-ink">{report.peakConcurrentModels}</span>
              <span className="text-ink-muted">Janela de silêncio</span>
              <span className="text-ink">
                {report.silenceWindow
                  ? `${(report.silenceWindow.startOffsetMs / 1000).toFixed(1)}s – ${(report.silenceWindow.endOffsetMs / 1000).toFixed(1)}s`
                  : "não localizada"}
              </span>
            </CardContent>
          </Card>

          {report.models.map((model) => (
            <Card key={model.modelId}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {model.label}
                  {model.silenceGate === "pass" && <Badge tone="positive">silêncio ok</Badge>}
                  {model.silenceGate === "fail" && (
                    <Badge tone="destructive">fabricou no silêncio</Badge>
                  )}
                  {model.silenceGate === "indeterminate" && (
                    <Badge tone="neutral">silêncio não medido</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                {!model.loaded ? (
                  <div className="flex flex-col gap-1">
                    <p className="text-destructive">
                      Não carregou:{" "}
                      {BROKEN_LINK_LABEL[model.brokenLink ?? "unknown"]} (
                      <code>{model.brokenLink ?? "unknown"}</code>). Isto{" "}
                      <strong>não</strong> significa que o outro modelo venceu.
                    </p>
                    {model.lastCompletedFile && (
                      <p className="break-all text-xs text-ink-muted">
                        Último arquivo inteiro: {model.lastCompletedFile}
                      </p>
                    )}
                    {model.loadErrorMessage && (
                      <p className="break-all text-xs text-ink-muted">
                        {model.loadErrorName}: {model.loadErrorMessage}
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-ink-muted">
                        Transcrição
                      </p>
                      <p className="text-ink">{model.text || "(vazio)"}</p>
                    </div>
                    {model.quality && (
                      <div className="grid grid-cols-2 gap-1">
                        <span className="text-ink-muted">WER bruto</span>
                        <span className="text-ink">{rate(model.quality.werRaw.rate)}</span>
                        <span className="text-ink-muted">WER normalizado</span>
                        <span className="text-ink">
                          {rate(model.quality.werNormalized.rate)}
                        </span>
                        <span className="text-ink-muted">CER</span>
                        <span className="text-ink">{rate(model.quality.cer.rate)}</span>
                        <span className="text-ink-muted">S / D / I</span>
                        <span className="text-ink">
                          {model.quality.werNormalized.substitutions} /{" "}
                          {model.quality.werNormalized.deletions} /{" "}
                          {model.quality.werNormalized.insertions}
                        </span>
                        <span className="text-ink-muted">Palavras na referência</span>
                        <span className="text-ink">
                          {model.quality.werNormalized.referenceLength}
                        </span>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-1">
                      <span className="text-ink-muted">Carga</span>
                      <span className="text-ink">{milliseconds(model.metrics.loadMs)}</span>
                      <span className="text-ink-muted">Transcrição</span>
                      <span className="text-ink">
                        {milliseconds(model.metrics.inferenceMs)}
                      </span>
                      <span className="text-ink-muted">Total</span>
                      <span className="text-ink">{milliseconds(model.metrics.totalMs)}</span>
                      <span className="text-ink-muted">Pico de heap</span>
                      <span className="text-ink">
                        {model.metrics.peakHeapBytes === null
                          ? "não medido"
                          : megabytes(model.metrics.peakHeapBytes)}
                      </span>
                    </div>
                    {model.fabricatedDuringSilence.length > 0 && (
                      <div className="rounded-control bg-destructive-soft p-2">
                        <p className="text-xs font-medium text-destructive">
                          Texto produzido dentro do silêncio:
                        </p>
                        {model.fabricatedDuringSilence.map((segment, index) => (
                          <p key={index} className="text-sm text-destructive">
                            “{segment.text}”
                          </p>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader>
              <CardTitle>Sua leitura</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-ink-muted">
                WER mede distância entre dois textos. Ele não sabe que trocar “não
                consegui” por “consegui” inverte a frase, nem quanto de bateria o
                modelo custou. A escolha é sua, e nada aqui troca o modelo padrão.
              </p>
              <div className="flex flex-wrap gap-2">
                {VOTES.map((option) => (
                  <Button
                    key={option.id}
                    variant={vote === option.id ? "primary" : "secondary"}
                    size="sm"
                    onClick={() => setVote(option.id)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-ink-muted">
                Este voto é QA de modelo. Ele não é avaliação de transcrição do
                produto, não vira dado de treinamento e não é gravado em lugar nenhum
                — ele sai daqui na cópia abaixo.
              </p>
              <Button variant="soft" size="sm" onClick={copyResult} className="self-start">
                {copied ? "Copiado" : "Copiar resultado"}
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
