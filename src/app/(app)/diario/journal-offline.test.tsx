import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JournalView } from "@/app/(app)/diario/view";
import { NETWORK_UNAVAILABLE_MESSAGE } from "@/lib/network-status";
import { MockProvider } from "@/mocks/store";



const ANOTACAO = "Hoje foi um dia estranho, mas terminou melhor.";

let fetchMock: ReturnType<typeof vi.fn>;

function entradaSalva(body: string) {
  const input = JSON.parse(body) as { id: string; title: string; content: string };
  return {
    data: {
      id: input.id,
      title: input.title,
      content: input.content,
      status: "saved",
      tagIds: [],
      createdAt: "2026-09-12T00:00:00.000Z",
      updatedAt: "2026-09-12T00:00:00.000Z",
      trashedAt: null,
    },
  };
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("queda de rede no meio de uma anotacao", () => {
  it("preserva o texto, explica a falta de conexao e reusa o rascunho na retentativa", async () => {
    // Primeira tentativa: o `fetch` rejeita, como numa troca de rede.
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(
      <MockProvider>
        <JournalView />
      </MockProvider>,
    );

    const conteudo = screen.getByLabelText("Anotação");
    fireEvent.change(conteudo, { target: { value: ANOTACAO } });

    // `commit` cancela o autosave pendente, entao o clique imediato produz
    // exatamente uma tentativa.
    fireEvent.click(screen.getByRole("button", { name: "Salvar anotação" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        NETWORK_UNAVAILABLE_MESSAGE,
      ),
    );

    // 1. O texto continua onde estava. Nada foi limpo "para tentar de novo".
    expect(screen.getByLabelText("Anotação")).toHaveValue(ANOTACAO);

    // 2. A mensagem fala de conexao, e nao de recusa.
    expect(screen.getByRole("alert")).toHaveTextContent(/sem conexão/i);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/não foi possível salvar/i);

    const rascunho = screen
      .getByTestId("autosave-status")
      .getAttribute("data-draft-id");
    expect(rascunho).toBeTruthy();

    // Segunda tentativa, agora com rede.
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) =>
      Response.json(entradaSalva(String(init.body))),
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar anotação" }));

    await waitFor(() => expect(screen.getByLabelText("Anotação")).toHaveValue(""));

    // 3. O mesmo rascunho: a retentativa atualiza a entrada, nao cria outra.
    const enviados = fetchMock.mock.calls
      .filter((call) => typeof call[1]?.body === "string")
      .map((call) => JSON.parse(String(call[1].body)) as { id: string; content: string });
    const comTexto = enviados.filter((corpo) => corpo.content === ANOTACAO);
    expect(comTexto.length).toBeGreaterThanOrEqual(2);
    expect(new Set(comTexto.map((corpo) => corpo.id))).toEqual(new Set([rascunho]));
  });

  it("erro do servidor continua dizendo o que o servidor disse", async () => {
    /*
      A distincao tem que sobreviver: falha de transporte vira "sem conexao",
      mas uma recusa do servidor precisa chegar com a propria mensagem. Se as
      duas colapsassem, a pessoa tentaria de novo contra um erro que nao muda.
    */
    fetchMock.mockResolvedValue(
      Response.json({ error: "Anotação muito longa." }, { status: 400 }),
    );

    render(
      <MockProvider>
        <JournalView />
      </MockProvider>,
    );

    fireEvent.change(screen.getByLabelText("Anotação"), {
      target: { value: ANOTACAO },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar anotação" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Anotação muito longa."),
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(/sem conexão/i);
    expect(screen.getByLabelText("Anotação")).toHaveValue(ANOTACAO);
  });
});
