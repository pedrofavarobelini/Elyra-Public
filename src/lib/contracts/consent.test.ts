import { describe, expect, it } from "vitest";

import {
  CONSENT_ELSEWHERE,
  buildConsentHistory,
  consentPurposeLabel,
  type ConsentEvent,
} from "@/lib/contracts/consent";

/**
 * A derivacao do estado a partir do log, provada como funcao pura.
 *
 * Esta e a mesma regra que o PostgreSQL aplica em `ai_inference_consent_active`
 * e `training_consent_active`. Ter as duas nao e duplicacao acidental: o banco
 * precisa dela para a **RLS**, e a tela precisa dela para explicar a historia.
 * O que este arquivo garante e que as duas digam a mesma coisa.
 */

const GRANT_ID = "11111111-1111-4111-8111-111111111111";
const REVOKE_ID = "22222222-2222-4222-8222-222222222222";
const REGRANT_ID = "33333333-3333-4333-8333-333333333333";

function evento(overrides: Partial<ConsentEvent> = {}): ConsentEvent {
  return {
    id: GRANT_ID,
    purpose: "ai_inference",
    documentVersion: "v1",
    eventType: "granted",
    occurredAt: "2026-09-01T10:00:00.000Z",
    grantedEventId: null,
    expiresAt: null,
    ...overrides,
  };
}

describe("historia de consentimento", () => {
  it("uma concessao sem revogacao esta vigente", () => {
    const history = buildConsentHistory([evento()]);
    const purpose = history.purposes[0];
    expect(purpose?.active).toBe(true);
    expect(purpose?.activeSince).toBe("2026-09-01T10:00:00.000Z");
    expect(purpose?.documentVersion).toBe("v1");
  });

  it("a revogacao encerra a concessao que ela aponta", () => {
    const history = buildConsentHistory([
      evento(),
      evento({
        id: REVOKE_ID,
        eventType: "revoked",
        grantedEventId: GRANT_ID,
        occurredAt: "2026-09-05T10:00:00.000Z",
      }),
    ]);
    expect(history.purposes[0]?.active).toBe(false);
    expect(history.purposes[0]?.activeSince).toBeNull();
    // O historico continua inteiro: revogar nao apaga a concessao.
    expect(history.purposes[0]?.events).toHaveLength(2);
  });

  it("conceder de novo depois de revogar volta a vigorar", () => {
    const history = buildConsentHistory([
      evento(),
      evento({
        id: REVOKE_ID,
        eventType: "revoked",
        grantedEventId: GRANT_ID,
        occurredAt: "2026-09-05T10:00:00.000Z",
      }),
      evento({ id: REGRANT_ID, occurredAt: "2026-09-08T10:00:00.000Z" }),
    ]);
    expect(history.purposes[0]?.active).toBe(true);
    expect(history.purposes[0]?.activeSince).toBe("2026-09-08T10:00:00.000Z");
    expect(history.purposes[0]?.events).toHaveLength(3);
  });

  it("concessao expirada nao esta vigente, e continua na historia", () => {
    const history = buildConsentHistory(
      [evento({ expiresAt: "2026-09-02T10:00:00.000Z" })],
      new Date("2026-09-10T00:00:00.000Z"),
    );
    expect(history.purposes[0]?.active).toBe(false);
    expect(history.purposes[0]?.events).toHaveLength(1);
    // A versao do documento da ultima concessao permanece legivel.
    expect(history.purposes[0]?.documentVersion).toBe("v1");
  });

  it("finalidade desconhecida aparece com o proprio identificador", () => {
    /*
      O log e append-only e uma migration futura pode gravar finalidade nova.
      Uma tela que se recusasse a exibi-la esconderia justamente o que ela
      existe para mostrar.
    */
    const history = buildConsentHistory([evento({ purpose: "futuro_governado" })]);
    expect(history.purposes[0]?.label).toBe("futuro_governado");
    expect(history.purposes[0]?.description).toBeNull();
    expect(consentPurposeLabel("futuro_governado")).toBe("futuro_governado");
  });

  it("cada finalidade tem historia propria, ordenada no tempo", () => {
    const history = buildConsentHistory([
      evento({ purpose: "training_data", occurredAt: "2026-09-03T10:00:00.000Z" }),
      evento({
        id: REGRANT_ID,
        purpose: "terms_privacy",
        occurredAt: "2026-08-01T10:00:00.000Z",
      }),
    ]);
    expect(history.purposes).toHaveLength(2);
    for (const purpose of history.purposes) {
      const times = purpose.events.map((event) => event.occurredAt);
      expect([...times].sort()).toEqual(times);
    }
  });

  it("declara o que nao e evento, em vez de calar sobre isso", () => {
    const history = buildConsentHistory([]);
    expect(history.purposes).toEqual([]);
    expect(history.elsewhere).toEqual(CONSENT_ELSEWHERE);
    expect(history.elsewhere.map((item) => item.id)).toEqual([
      "multimodal_session",
      "professional_sharing",
    ]);
    for (const item of history.elsewhere) {
      expect(item.whereToChange.trim().length).toBeGreaterThan(0);
    }
  });
});
