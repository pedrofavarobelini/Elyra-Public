import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SESSION_SETUP, type MultimodalSessionDetail } from "@/lib/contracts/session";
import { stopCaptureTracks } from "@/lib/multimodal-capture";

import { Stage11LiveCaptureView } from "./capture-view";

/*
  L-158: "Finalizar sessao" sem observabilidade.

  Na homologacao fisica a pessoa tocava em finalizar e ficava sem saber se o
  Elyra processava, em qual etapa estava, ou se tinha parado. Estes testes
  percorrem o caminho real de `finishSession` - coleta, gravacao, PATCH e POST
  de analise - com a rede sob controle do teste.
*/

const h = vi.hoisted(() => ({ push: vi.fn(), requestMedia: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push }),
  useSearchParams: () => new URLSearchParams("id=22222222-2222-4222-8222-222222222222"),
}));
vi.mock("@/lib/multimodal-derivation", async (original) => ({
  ...await original<object>(),
  probeLocalSpeechAvailability: async () => "unavailable",
  startAudioEnvelopeCollection: () => ({ stop: () => ({ envelope: Array(40).fill(0.1), frameMs: 100 }) }),
}));
vi.mock("@/lib/multimodal-capture", async (original) => ({
  ...await original<object>(),
  detectCaptureCapabilities: () => ({ screen: true, camera: true, microphone: true }),
  requestCaptureStream: (...args: unknown[]) => h.requestMedia(...args),
  createCaptureRecorder: (_resource: string, stream: unknown) => ({ stream, recorder: { state: "recording" }, chunks: [] }),
  stopCaptureRecorder: async () => ({ blob: new Blob([]), durationMs: 1000 }),
  stopCaptureTracks: vi.fn(),
}));

type Deferred = { promise: Promise<Response>; resolve: (value: Response) => void };
function deferred(): Deferred {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((r) => { resolve = r; });
  return { promise, resolve };
}

let detail: MultimodalSessionDetail;
let requests: { url: string; method: string; body: Record<string, unknown> }[];
let analysis: Deferred | null;
let failPatchCompleted: boolean;

beforeEach(() => {
  vi.clearAllMocks();
  h.requestMedia.mockResolvedValue({ getTracks: () => [] });
  detail = {
    id: "22222222-2222-4222-8222-222222222222", kind: "guided", status: "preparing",
    setup: { ...DEFAULT_SESSION_SETUP, microphone: true, aiAnalysis: true },
    startedAt: new Date().toISOString(), endedAt: null, assets: [],
  };
  requests = [];
  analysis = null;
  failPatchCompleted = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    requests.push({ url, method, body });
    if (method === "PATCH" && body.status === "completed" && failPatchCompleted) {
      return Response.json({ error: "Sessão não pôde ser salva." }, { status: 500 });
    }
    if (method === "PATCH") detail = { ...detail, status: body.status };
    if (url.endsWith("/analysis") && method === "POST") {
      if (analysis) return analysis.promise;
      return Response.json({ data: { ok: true } }, { status: 201 });
    }
    return Response.json({ data: detail });
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function openFinishDialog() {
  render(<Stage11LiveCaptureView />);
  const start = await screen.findByRole("button", { name: "Solicitar permissões e iniciar" });
  await waitFor(() => expect(screen.getByTestId("capture-state-microphone")).toHaveTextContent("Suportado"));
  await waitFor(() => expect(start).toBeEnabled());
  fireEvent.click(start);
  fireEvent.click(await screen.findByRole("button", { name: "Finalizar sessão" }));
  const dialog = screen.getByRole("dialog");
  return { dialog, confirm: within(dialog).getByRole("button", { name: "Finalizar sessão" }) };
}

const percent = () => Number(screen.getByTestId("finalization-progress").dataset.percent);
const count = (predicate: (r: (typeof requests)[number]) => boolean) => requests.filter(predicate).length;
const isAnalysis = (r: (typeof requests)[number]) => r.url.endsWith("/analysis") && r.method === "POST";
const isCompleted = (r: (typeof requests)[number]) => r.method === "PATCH" && r.body.status === "completed";

describe("L-158: progresso de finalizacao", () => {
  it("A/E/F: confirmar troca o modal imediatamente para processamento com etapa e tempo", async () => {
    analysis = deferred();
    const { confirm } = await openFinishDialog();
    fireEvent.click(confirm);
    const panel = screen.getByTestId("finalization-progress");
    expect(panel).toHaveTextContent("Finalizando sessão");
    expect(panel).toHaveTextContent("Não feche esta página enquanto a sessão é finalizada.");
    expect(screen.getByTestId("finalization-step")).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("finalization-elapsed")).toHaveTextContent(/^Tempo decorrido: \d+ s$/);
    expect(screen.getByRole("progressbar", { name: "Progresso da finalização" })).toBeInTheDocument();
    // O autorrelato e os botoes saem: nao ha como disparar outra acao no meio.
    expect(screen.queryByRole("button", { name: "Finalizar sessão" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar e excluir" })).toBeNull();
    expect(panel).not.toHaveTextContent(/faltam|restante/i);
    // Drena o encerramento inteiro: um POST que saisse depois do cleanup
    // vazaria para o teste seguinte.
    await waitFor(() => expect(count(isAnalysis)).toBe(1));
    await act(async () => analysis?.resolve(Response.json({ data: { ok: true } }, { status: 201 })));
    await waitFor(() => expect(h.push).toHaveBeenCalled());
  });

  it("B/C/D: marcos avancam sem regredir e 100% so depois da analise concluida", async () => {
    analysis = deferred();
    const { confirm } = await openFinishDialog();
    const seen: number[] = [];
    fireEvent.click(confirm);
    seen.push(percent());
    await waitFor(() => expect(screen.getByTestId("finalization-step")).toHaveTextContent("Analisando a sessão"));
    seen.push(percent());
    expect(count(isAnalysis)).toBe(1);
    expect(percent()).toBeGreaterThan(0);
    expect(percent()).toBeLessThan(100);
    expect(h.push).not.toHaveBeenCalled();
    await act(async () => analysis?.resolve(Response.json({ data: { ok: true } }, { status: 201 })));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith(`/sessoes/${detail.id}`));
    seen.push(percent());
    expect(seen.at(-1)).toBe(100);
    expect(screen.getByTestId("finalization-step")).toHaveTextContent("Sessão finalizada");
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it("G: dois cliques no mesmo tick nao duplicam a finalizacao", async () => {
    const { confirm } = await openFinishDialog();
    act(() => { confirm.click(); confirm.click(); });
    await waitFor(() => expect(h.push).toHaveBeenCalled());
    expect(count(isCompleted)).toBe(1);
    expect(count(isAnalysis)).toBe(1);
  });

  it("H/J: falha real da analise sai do carregamento, preserva a medida e ainda libera dispositivos", async () => {
    analysis = deferred();
    const { confirm } = await openFinishDialog();
    fireEvent.click(confirm);
    await waitFor(() => expect(count(isAnalysis)).toBe(1));
    await act(async () => analysis?.resolve(Response.json({ error: "Processamento indisponível." }, { status: 503 })));
    await waitFor(() => expect(screen.queryByTestId("finalization-progress")).toBeNull());
    expect(screen.getByRole("alert")).toHaveTextContent("Processamento indisponível.");
    expect(screen.getByTestId("retry-analysis")).toBeEnabled();
    expect(h.push).not.toHaveBeenCalled();
    expect(stopCaptureTracks).toHaveBeenCalled();
  });

  it("H: falha fora da analise nomeia a etapa e nao deixa carregamento infinito", async () => {
    failPatchCompleted = true;
    const { confirm } = await openFinishDialog();
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByTestId("finalization-progress")).toBeNull());
    expect(screen.getByRole("alert")).toHaveTextContent("Sessão não pôde ser salva. (etapa: Salvando a sessão)");
    expect(count(isAnalysis)).toBe(0);
    expect(h.push).not.toHaveBeenCalled();
    expect(stopCaptureTracks).toHaveBeenCalled();
  });

  it("I: IA OFF nao mostra nem espera etapa de IA", async () => {
    detail = { ...detail, setup: { ...detail.setup, aiAnalysis: false } };
    analysis = deferred();
    const { confirm } = await openFinishDialog();
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByTestId("finalization-step")).toHaveTextContent("Salvando a análise da sessão"));
    expect(screen.queryByText("Analisando a sessão")).toBeNull();
    await act(async () => analysis?.resolve(Response.json({ data: { ok: true } }, { status: 201 })));
    await waitFor(() => expect(h.push).toHaveBeenCalled());
    expect(percent()).toBe(100);
  });

  it("stall: etapa lenta avisa sem cancelar, e o modal nao fecha no meio", async () => {
    analysis = deferred();
    const { confirm } = await openFinishDialog();
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByTestId("finalization-step")).toHaveTextContent("Analisando a sessão"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 120_000);
    await waitFor(() => expect(screen.getByTestId("finalization-stall")).toHaveTextContent(
      "Esta etapa está demorando mais que o esperado. O processamento ainda está em andamento.",
    ), { timeout: 3000 });
    expect(screen.getByTestId("finalization-elapsed")).toHaveTextContent(/Tempo decorrido: 1[2-9]\d s/);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.getByTestId("finalization-progress")).toBeInTheDocument();
    expect(h.push).not.toHaveBeenCalled();
    await act(async () => analysis?.resolve(Response.json({ data: { ok: true } }, { status: 201 })));
    await waitFor(() => expect(h.push).toHaveBeenCalled());
  });
});
