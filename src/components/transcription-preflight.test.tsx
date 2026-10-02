import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SESSION_SETUP, type MultimodalSessionDetail } from "@/lib/contracts/session";
import { createSpeechPreparation } from "@/lib/speech/preparation";
import { SessionsView } from "@/app/(app)/sessoes/view";
import { Stage11LiveCaptureView } from "@/app/(app)/sessoes/nova/capture-view";
import { readAsrDiagnostic } from "@/lib/speech/physical-diagnostic";

const h = vi.hoisted(() => ({
  preparation: null as unknown as ReturnType<typeof createSpeechPreparation>,
  native: "unavailable" as "available" | "unavailable",
  push: vi.fn(), requestMedia: vi.fn(), nativeStart: vi.fn(),
  vad: vi.fn(), asr: vi.fn(),
}));
vi.mock("@/lib/speech/preparation", async (original) => ({
  ...await original<object>(),
  speechPreparation: {
    getSnapshot: () => h.preparation.getSnapshot(),
    getServerSnapshot: () => h.preparation.getServerSnapshot(),
    subscribe: (fn: () => void) => h.preparation.subscribe(fn),
    prepare: () => h.preparation.prepare(), cancel: () => h.preparation.cancel(),
    attach: (...args: Parameters<typeof h.preparation.attach>) => h.preparation.attach(...args),
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }), useSearchParams: () => new URLSearchParams("id=11111111-1111-4111-8111-111111111111") }));
vi.mock("@/mocks/store", async () => {
  const { useState } = await import("react");
  const { DEFAULT_SESSION_SETUP } = await import("@/lib/contracts/session");
  return { useMockStore: () => {
    const [sessionSetup, set] = useState(DEFAULT_SESSION_SETUP);
    return { sessionsEnabled: true, sessionSetup,
      updateSessionSetup: (patch: object) => set((s) => ({ ...s, ...patch })),
      resetSessionSetup: () => set(DEFAULT_SESSION_SETUP), setSessionsEnabled: vi.fn() };
  } };
});
vi.mock("@/lib/multimodal-derivation", async (original) => ({
  ...await original<object>(),
  probeLocalSpeechAvailability: async () => h.native,
  startSessionTranscription: (...args: unknown[]) => h.nativeStart(...args),
  startAudioEnvelopeCollection: () => ({ stop: () => ({ envelope: Array(40).fill(0.1), frameMs: 100 }) }),
}));
vi.mock("@/lib/speech/browser-audio", async (original) => ({
  ...await original<object>(),
  startBrowserPcmCollection: () => ({ available: true, stop: () => new Float32Array(32000).fill(0.1), sampleCount: () => 32000 }),
}));
vi.mock("@/lib/multimodal-capture", async (original) => ({
  ...await original<object>(),
  detectCaptureCapabilities: () => ({ screen: true, camera: true, microphone: true }),
  requestCaptureStream: (...args: unknown[]) => h.requestMedia(...args),
  createCaptureRecorder: (_resource: string, stream: unknown) => ({ stream, recorder: { state: "recording" }, chunks: [] }),
  stopCaptureRecorder: async () => new Blob([]),
  stopCaptureTracks: vi.fn(),
}));

let detail: MultimodalSessionDetail;
let requests: { url: string; method: string; body: Record<string, unknown> }[];
beforeEach(() => {
  vi.clearAllMocks();
  h.native = "unavailable";
  h.vad.mockResolvedValue({ value: { reset: vi.fn(), process: () => 0.9 }, failure: null });
  h.asr.mockResolvedValue({ value: { transcribe: async () => ({ text: "frase sintetica para teste" }) }, failure: null });
  h.preparation = createSpeechPreparation({ vad: h.vad, asr: h.asr });
  h.requestMedia.mockResolvedValue({ getTracks: () => [] });
  h.nativeStart.mockReturnValue({ stop: async () => ({ status: "unavailable", reason: "no_speech_detected" }) });
  detail = { id: "11111111-1111-4111-8111-111111111111", kind: "guided", status: "preparing",
    setup: { ...DEFAULT_SESSION_SETUP, microphone: true, transcribe: true },
    startedAt: new Date().toISOString(), endedAt: null, assets: [] };
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    requests.push({ url, method, body });
    if (method === "PATCH") detail = { ...detail, status: body.status };
    return Response.json({ data: url === "/api/multimodal/sessions" && method === "GET" ? [] : detail });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); sessionStorage.clear(); });

async function selectTranscription() {
  render(<SessionsView />);
  await waitFor(() => expect(screen.getByRole("switch", { name: "Usar microfone" })).toBeEnabled());
  fireEvent.click(screen.getByRole("switch", { name: "Usar microfone" }));
  fireEvent.click(screen.getByRole("switch", { name: "Gerar transcrição" }));
  await screen.findByTestId("transcription-preflight");
}

describe("preflight nas telas reais", () => {
  it("o botao anuncia o tamanho do modelo que vai ser baixado de verdade", async () => {
    /*
      Regressao de um finding de auditoria.

      `ASR_DOWNLOAD_BYTES` estava presa ao `whisper-base` e nao mudou quando o
      padrao virou o `small`. A tela pedia autorizacao dizendo "~78 MB" para um
      download de ~254 MB - alguem em rede movel autorizaria 78 e pagaria 254.

      Os testes que ja existiam casavam `/^Preparar transcricao local/` e nunca
      olhavam o numero. Por isso o defeito atravessou a suite inteira.

      O 254 aqui e escrito a mao de proposito: derivar a expectativa da mesma
      constante que se quer testar provaria apenas que o arquivo concorda
      consigo mesmo.
    */
    await selectTranscription();
    expect(
      await screen.findByRole("button", { name: "Preparar transcrição local (~254 MB)" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Preparar transcrição local \(~78 MB\)/ }),
    ).toBeNull();
  });

  it("L-157: preparo mostra etapa, MB e percentual, avisa da demora e permite cancelar", async () => {
    let emit!: (event: { status: string; file: string; loaded?: number; total?: number }) => void;
    h.asr.mockImplementationOnce((options: { onLoadEvent: typeof emit; signal: AbortSignal }) => new Promise((resolve) => {
      emit = options.onLoadEvent;
      options.signal.addEventListener("abort", () => resolve({ value: null, failure: "cancelled" }));
    }));
    await selectTranscription();
    fireEvent.click(await screen.findByRole("button", { name: /^Preparar transcrição local/ }));
    await waitFor(() => expect(h.asr).toHaveBeenCalledOnce());
    act(() => emit({ status: "progress", file: "onnx/decoder", loaded: 84_000_000, total: 252_000_000 }));
    const box = screen.getByTestId("transcription-preparation-progress");
    expect(box).toHaveTextContent("Preparando reconhecimento local…");
    expect(box).toHaveTextContent("Baixando modelo: 86 MB / 254 MB — 33%");
    expect(box).toHaveTextContent("O primeiro preparo pode levar vários minutos");
    expect(box).toHaveTextContent("aproveitar os arquivos já baixados");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar preparo" }));
    await waitFor(() => expect(screen.getByText("O preparo da transcrição local foi cancelado.")).toBeVisible());
    expect(screen.queryByTestId("transcription-preparation-progress")).toBeNull();
    expect(screen.getByRole("button", { name: /^Preparar transcrição local/ })).toBeEnabled();
  });

  it("regressao fisica: promessa sem prontidao bloqueia POST e mostra preparo antes de captura", async () => {
    await selectTranscription();
    const start = screen.getByRole("button", { name: "Iniciar sessão" });
    expect(start).toBeDisabled();
    expect(await screen.findByRole("button", { name: /^Preparar transcrição local/ })).toBeVisible();
    fireEvent.click(start);
    expect(requests.filter((r) => r.method === "POST")).toEqual([]);
    expect(h.requestMedia).not.toHaveBeenCalled();
    expect(h.vad).not.toHaveBeenCalled();
    expect(h.asr).not.toHaveBeenCalled();
  });
  it("native available inicia sem preparar fallback", async () => {
    h.native = "available";
    await selectTranscription();
    await waitFor(() => expect(screen.getByRole("button", { name: "Iniciar sessão" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sessão" }));
    await waitFor(() => expect(h.push).toHaveBeenCalled());
    expect(requests.find((r) => r.method === "POST")?.body.transcribe).toBe(true);
    expect(h.vad).not.toHaveBeenCalled();
  });
  it("revalida disponibilidade antes do POST mesmo com botao previamente habilitado", async () => {
    h.native = "available";
    await selectTranscription();
    const start = screen.getByRole("button", { name: "Iniciar sessão" });
    await waitFor(() => expect(start).toBeEnabled());
    h.native = "unavailable";
    fireEvent.click(start);
    await screen.findByText("A transcrição ainda não está pronta. Prepare ou escolha continuar sem transcrição.");
    expect(requests.filter((r) => r.method === "POST")).toEqual([]);
  });
  it("transcription=false inicia sem sonda ou carga de modelos", async () => {
    render(<SessionsView />);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Usar microfone" })).toBeEnabled());
    fireEvent.click(screen.getByRole("switch", { name: "Usar microfone" }));
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sessão" }));
    await waitFor(() => expect(h.push).toHaveBeenCalled());
    expect(h.vad).not.toHaveBeenCalled();
    expect(h.asr).not.toHaveBeenCalled();
  });
  it("preparo explicito habilita inicio; proxima sessao nao herda consentimento", async () => {
    await selectTranscription();
    fireEvent.click(await screen.findByRole("button", { name: /^Preparar transcrição local/ }));
    await waitFor(() => expect(screen.getByTestId("transcription-preflight")).toHaveAttribute("data-state", "READY_LOCAL"));
    expect(h.requestMedia).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sessão" }));
    await waitFor(() => expect(h.push).toHaveBeenCalled());
    expect(screen.getByRole("switch", { name: "Gerar transcrição" })).not.toBeChecked();
    expect(h.preparation.getSnapshot().status).toBe("ready");
  });
  it("continuar sem transcricao desliga toggle e consentimento antes do POST", async () => {
    await selectTranscription();
    fireEvent.click(await screen.findByRole("button", { name: "Continuar sem transcrição" }));
    await waitFor(() => expect(h.push).toHaveBeenCalled());
    expect(requests.find((r) => r.method === "POST")?.body).toMatchObject({ transcribe: false, shareTranscript: false });
    expect(screen.getByRole("switch", { name: "Gerar transcrição" })).not.toBeChecked();
    expect(h.asr).not.toHaveBeenCalled();
  });
  it("reload da captura sem runtime tambem bloqueia getUserMedia", async () => {
    render(<Stage11LiveCaptureView />);
    const start = await screen.findByRole("button", { name: "Solicitar permissões e iniciar" });
    expect(start).toBeDisabled();
    fireEvent.click(start);
    expect(h.requestMedia).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: /^Preparar transcrição local/ })).toBeVisible();
  });
  it("READY_LOCAL liga engine apos microfone sem nativo, com keepRecording=false", async () => {
    vi.stubEnv("NEXT_PUBLIC_ASR_QA_DIAGNOSTICS", "1");
    await h.preparation.prepare();
    render(<Stage11LiveCaptureView />);
    const start = await screen.findByRole("button", { name: "Solicitar permissões e iniciar" });
    await waitFor(() => expect(start).toBeEnabled());
    await waitFor(() => expect(screen.getByTestId("capture-state-microphone")).toHaveTextContent("Suportado"));
    expect(screen.queryByTestId("local-speech-state")).not.toBeInTheDocument();
    fireEvent.click(start);
    await waitFor(() => expect(screen.getByTestId("local-asr-state")).toHaveAttribute("data-state", "active"));
    expect(h.requestMedia).toHaveBeenCalledOnce();
    expect(h.nativeStart).not.toHaveBeenCalled();
    expect(h.vad).toHaveBeenCalledOnce();
    expect(detail.setup.keepRecording).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Finalizar sessão" }));
    const dialog = screen.getByRole("dialog");
    const { within } = await import("@testing-library/react");
    fireEvent.click(within(dialog).getByRole("button", { name: "Finalizar sessão" }));
    await waitFor(() => expect(requests.some((r) => r.url.endsWith("/analysis") && r.method === "POST")).toBe(true));
    expect(requests.find((r) => r.url.endsWith("/analysis"))?.body.transcript).toMatchObject({ status: "available" });
    expect(requests.some((r) => r.url.includes("/assets") || r.url.includes("/storage"))).toBe(false);
    expect(readAsrDiagnostic(detail.id)).toMatchObject({ pcmSampleCount: 32000,
      vadCalled: true, whisperCalled: true, acceptedCount: 1, finalTranscriptStatus: "available" });
    expect(JSON.stringify(requests.find((r) => r.url.endsWith("/analysis"))?.body)).not.toContain("pcmSampleCount");
  });
});
