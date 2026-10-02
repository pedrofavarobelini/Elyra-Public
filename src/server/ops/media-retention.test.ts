import { describe, expect, it } from "vitest";

import { PURGEABLE_STATUSES, isExpired } from "./media-retention";

/**
 * A fronteira do expurgo e a unica regra ambigua de `L-043`, e ambiguidade em
 * retencao vira ou midia apagada cedo demais ou midia que nunca morre. Por isso
 * ela vive numa funcao propria e e testada no instante exato, nao "por volta
 * de".
 */
describe("isExpired - fronteira de retencao", () => {
  const boundary = "2026-08-27T12:00:00.000Z";

  it("um milissegundo antes do carimbo, a midia vive", () => {
    expect(isExpired(boundary, new Date("2026-08-27T11:59:59.999Z"))).toBe(false);
  });

  it("no carimbo exato, a midia e expurgada", () => {
    // `retention_until` e o instante em que a retencao TERMINA, nao o ultimo
    // instante em que ela vale. Com `<`, uma midia cuja retencao acabou agora
    // sobreviveria ate a proxima execucao do scheduler - e "proxima execucao"
    // nao e um prazo, e uma esperanca.
    expect(isExpired(boundary, new Date(boundary))).toBe(true);
  });

  it("depois do carimbo, a midia e expurgada", () => {
    expect(isExpired(boundary, new Date("2026-08-27T12:00:00.001Z"))).toBe(true);
  });

  it("uma retencao distante no futuro nunca e recolhida", () => {
    expect(isExpired("2099-01-01T00:00:00.000Z", new Date(boundary))).toBe(false);
  });

  it("fuso diferente nao muda o instante comparado", () => {
    // `2026-08-27T09:00:00-03:00` e o mesmo instante que `12:00:00Z`. Se a
    // comparacao fosse textual em vez de temporal, este teste falharia.
    expect(isExpired("2026-08-27T09:00:00.000-03:00", new Date(boundary))).toBe(true);
  });
});

describe("estados recolhidos pelo expurgo", () => {
  it("recolhe `stored` e tambem `deleting`", () => {
    // `deleting` e o rastro de uma execucao que morreu depois de marcar e antes
    // de apagar. Ignorar esse estado deixaria o objeto vencido para sempre,
    // porque nenhuma execucao futura voltaria a olhar para ele.
    expect([...PURGEABLE_STATUSES]).toEqual(["stored", "deleting"]);
  });

  it("nao recolhe `uploading` nem `interrupted`", () => {
    // `uploading` pode ser um upload em curso; `interrupted` pertence ao fluxo
    // de sessao, nao ao de retencao. O expurgo so age sobre o que ja esta
    // gravado ou ja foi marcado para morrer.
    expect(PURGEABLE_STATUSES).not.toContain("uploading");
    expect(PURGEABLE_STATUSES).not.toContain("interrupted");
  });
});

/**
 * Cliente minimo, so com a superficie que o expurgo usa.
 *
 * O cenario que importa aqui nao pode ser produzido contra o Storage real: a
 * API responde sucesso ate para caminho inexistente, entao "remocao que falha"
 * nao e um estado que se consiga encomendar. Um dublê e a unica forma honesta
 * de exercitar a falha - e a falha e justamente onde mora a regra que protege
 * de orfao invisivel.
 */
function fakeClient(options: { removeFails?: boolean; stillPresent?: boolean }) {
  const deleted: string[] = [];
  const updated: { id: string; patch: unknown }[] = [];
  const audits: { outcome: string }[] = [];
  const rows = [
    {
      id: "asset-1",
      user_id: "user-1",
      session_id: "session-1",
      storage_path: "user-1/session-1/a.webm",
      retention_until: "2026-01-01T00:00:00.000Z",
      status: "stored",
    },
  ];

  const client = {
    from(table: string) {
      if (table === "audit_logs") {
        return {
          insert: (row: { outcome: string }) => {
            audits.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      return {
        select: () => ({
          in: () => ({
            lte: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: rows, error: null }),
              }),
            }),
          }),
        }),
        update: (patch: unknown) => ({
          eq: (_column: string, id: string) => {
            updated.push({ id, patch });
            return Promise.resolve({ error: null });
          },
        }),
        delete: () => ({
          eq: (_column: string, id: string) => {
            deleted.push(id);
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
    storage: {
      from: () => ({
        remove: () =>
          Promise.resolve(
            options.removeFails
              ? { error: { message: "storage indisponivel" } }
              : { error: null },
          ),
        list: () =>
          Promise.resolve({
            data: options.stillPresent ? [{ name: "a.webm" }] : [],
            error: null,
          }),
      }),
    },
  };

  return { client, deleted, updated, audits };
}

describe("falha de Storage nunca apaga a metadata", () => {
  it("remocao que falha deixa a linha no banco e reporta a falha", async () => {
    const { client, deleted, updated, audits } = fakeClient({ removeFails: true });
    const { purgeExpiredMedia } = await import("./media-retention");

    const report = await purgeExpiredMedia(client as never, {
      now: new Date("2026-06-01T00:00:00.000Z"),
    });

    // A tentacao e apagar a linha primeiro, porque essa operacao nunca falha.
    // Ela tambem produz o pior resultado possivel: objeto vivo no Storage e
    // ninguem que saiba que ele existe. Um vencido conhecido a proxima
    // execucao pega; um orfao invisivel ninguem pega.
    expect(deleted).toEqual([]);
    expect(report.metadataRemoved).toBe(0);
    expect(report.storageObjectsRemoved).toBe(0);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.reason).toMatch(/STORAGE_REMOVE_FAILED/);

    // A linha fica marcada `deleting`, que e o rastro que a proxima execucao
    // usa para retomar.
    expect(updated).toHaveLength(1);
    expect(updated[0]?.patch).toMatchObject({ status: "deleting" });
    expect(audits[0]?.outcome).toBe("failure");
  });

  it("objeto que sobrevive a remocao tambem preserva a metadata", async () => {
    // `remove()` responde sucesso ate para caminho inexistente, entao a
    // resposta dele nao prova nada. A prova e perguntar de novo - e se o
    // objeto ainda estiver la, a metadata nao pode sumir.
    const { client, deleted, audits } = fakeClient({ stillPresent: true });
    const { purgeExpiredMedia } = await import("./media-retention");

    const report = await purgeExpiredMedia(client as never, {
      now: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(deleted).toEqual([]);
    expect(report.metadataRemoved).toBe(0);
    expect(report.failures[0]?.reason).toBe("STORAGE_STILL_PRESENT");
    expect(audits[0]?.outcome).toBe("failure");
  });

  it("caminho feliz apaga objeto e metadata, nessa ordem", async () => {
    const { client, deleted, audits } = fakeClient({});
    const { purgeExpiredMedia } = await import("./media-retention");

    const report = await purgeExpiredMedia(client as never, {
      now: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(report.storageObjectsRemoved).toBe(1);
    expect(report.metadataRemoved).toBe(1);
    expect(deleted).toEqual(["asset-1"]);
    expect(report.failures).toEqual([]);
    expect(audits[0]?.outcome).toBe("success");
  });
});
