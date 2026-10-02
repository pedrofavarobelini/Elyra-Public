import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HistoryView } from "@/app/(app)/historico/view";
import { PERSONAL_WINDOW_DAYS } from "@/lib/contracts/personal-window";
import { MockProvider } from "@/mocks/store";



const janela = {
  days: PERSONAL_WINDOW_DAYS,
  since: "2026-05-20",
  hasOlder: true,
  olderCounts: { checkins: 2, journal: 0, sleep: 0, cycle_records: 0, goal_progress: 0 },
};

const checkinRecente = {
  id: "11111111-1111-4111-8111-111111111111",
  occurredAt: "2026-09-15T12:00:00.000Z",
  mood: 4,
  perceivedAnxiety: 2,
  energy: 3,
  primaryFeeling: "tranquilo" as const,
  note: "Dentro da janela",
  factorIds: [],
  createdAt: "2026-09-15T12:00:00.000Z",
};

const checkinAntigo = {
  ...checkinRecente,
  id: "22222222-2222-4222-8222-222222222222",
  occurredAt: "2026-01-10T12:00:00.000Z",
  note: "Bem antes da janela",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ data: { domain: "checkins", items: [checkinAntigo], nextBefore: null } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderHistory() {
  return render(
    <MockProvider
      initialEmotional={{ checkins: [checkinRecente], sleep: [], factors: [] }}
      initialWindow={janela}
    >
      <HistoryView />
    </MockProvider>,
  );
}

describe("historia anterior a janela", () => {
  it("diz quantos registros ficaram fora, com a janela nomeada", () => {
    renderHistory();
    const aviso = screen.getByTestId("older-history");
    expect(aviso).toHaveTextContent(`Mostrando os últimos ${PERSONAL_WINDOW_DAYS} dias`);
    expect(aviso).toHaveTextContent("2 registros anteriores");
  });


function linhasDeCheckins() {
  return within(
    screen.getByRole("region", { name: "Tabela de check-ins emocionais" }),
  ).getAllByRole("row");
}

  it("o gesto traz a pagina anterior e o aviso desaparece quando nao ha mais", async () => {
    renderHistory();
    // Uma linha de check-in na tabela antes de carregar (mais o cabecalho).
    expect(linhasDeCheckins()).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Carregar anteriores" }));

    await waitFor(() => expect(linhasDeCheckins()).toHaveLength(3));
    const [[url]] = fetchMock.mock.calls as [[string]];
    expect(url).toContain("/api/personal/history?domain=checkins&before=");
    /*
      O cursor e a borda mais antiga conhecida: na primeira ida e o inicio da
      janela (nada em memoria e mais antigo que ela); depois passa a ser o item
      mais antigo ja carregado. Numero de pagina nao serve — entre duas idas a
      pessoa pode registrar algo novo, e offset pularia ou repetiria linha.
    */
    expect(url).toContain(encodeURIComponent(janela.since));
  });

  it("resposta repetida nao duplica linha, e o aviso sai quando zera", async () => {
    renderHistory();
    const botao = () => screen.getByRole("button", { name: "Carregar anteriores" });

    fireEvent.click(botao());
    await waitFor(() => expect(linhasDeCheckins()).toHaveLength(3));

    // Servidor devolve o **mesmo** registro de novo (reenvio, cursor na borda).
    fireEvent.click(botao());
    await waitFor(() => expect(screen.queryByTestId("older-history")).toBeNull());
    expect(linhasDeCheckins()).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falha de rede vira mensagem, nao lista silenciosamente incompleta", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderHistory();

    fireEvent.click(screen.getByRole("button", { name: "Carregar anteriores" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar agora"),
    );
    expect(screen.getByTestId("older-history")).toHaveTextContent("2 registros anteriores");
  });
});
