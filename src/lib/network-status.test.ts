import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NETWORK_UNAVAILABLE_MESSAGE,
  NetworkUnavailableError,
  isBrowserOnline,
  isNetworkUnavailable,
  serverNetworkSnapshot,
  subscribeToNetworkStatus,
} from "@/lib/network-status";

/**
 * O modulo que separa "a rede caiu" de "o servidor recusou".
 *
 * A distincao existe porque as duas falhas pedem coisas opostas de quem esta na
 * tela: uma sugere tentar de novo, a outra sugere corrigir o que foi enviado.
 * Trata-las como a mesma mensagem apaga a unica informacao acionavel.
 */

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => value,
  });
}

afterEach(() => {
  setOnline(true);
  vi.restoreAllMocks();
});

describe("erro de rede", () => {
  it("carrega a mensagem em portugues que a tela ja exibe", () => {
    const error = new NetworkUnavailableError("/api/journal/entries");
    expect(error.message).toBe(NETWORK_UNAVAILABLE_MESSAGE);
    expect(error.message).toMatch(/continua aqui/);
    // Quem faz `caught instanceof Error ? caught.message : ...` — que e todo
    // chamador de escrita hoje — continua funcionando sem alteracao.
    expect(error).toBeInstanceOf(Error);
  });

  it("declara que vale a pena tentar de novo, e guarda a intencao", () => {
    const error = new NetworkUnavailableError("/api/emotional/checkins");
    expect(error.retryable).toBe(true);
    expect(error.intent).toBe("/api/emotional/checkins");
  });

  it("preserva a causa original para diagnostico", () => {
    const cause = new TypeError("Failed to fetch");
    expect(new NetworkUnavailableError("/x", cause).cause).toBe(cause);
  });

  it("reconhece somente a falha de transporte", () => {
    expect(isNetworkUnavailable(new NetworkUnavailableError())).toBe(true);
    // Erro de servidor nao vira "sem conexao": ele foi recebido e julgado.
    expect(isNetworkUnavailable(new Error("Não foi possível salvar."))).toBe(false);
    expect(isNetworkUnavailable(null)).toBe(false);
  });
});

describe("estado do navegador", () => {
  it("le navigator.onLine", () => {
    setOnline(false);
    expect(isBrowserOnline()).toBe(false);
    setOnline(true);
    expect(isBrowserOnline()).toBe(true);
  });

  it("no servidor assume online, para nao piscar aviso que nao existe", () => {
    expect(serverNetworkSnapshot()).toBe(true);
  });

  it("assina os dois eventos e remove os dois ao desinscrever", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const onChange = vi.fn();

    const unsubscribe = subscribeToNetworkStatus(onChange);
    expect(add).toHaveBeenCalledWith("online", onChange);
    expect(add).toHaveBeenCalledWith("offline", onChange);

    window.dispatchEvent(new Event("offline"));
    expect(onChange).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(remove).toHaveBeenCalledWith("online", onChange);
    expect(remove).toHaveBeenCalledWith("offline", onChange);

    // Depois de desinscrever, nenhum evento chega: um ouvinte esquecido em
    // componente desmontado e vazamento, e aqui seria um por navegacao.
    window.dispatchEvent(new Event("offline"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
