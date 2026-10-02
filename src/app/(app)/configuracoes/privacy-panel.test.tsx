import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PrivacyPanel } from "@/app/(app)/configuracoes/privacy-panel";
import {
  CONSENT_ELSEWHERE,
  EMPTY_CONSENT_HISTORY,
  buildConsentHistory,
  type ConsentEvent,
} from "@/lib/contracts/consent";
import {
  EMPTY_DATA_INVENTORY,
  buildDataInventory,
} from "@/lib/contracts/data-inventory";

/**
 * O painel de privacidade, provado pelo que ele diz — e pelo que ele recusa a
 * dizer.
 *
 * Duas familias de asserção convivem aqui:
 *
 *  - **degradacao por bloco**: a tela tem sete blocos independentes, e a falha
 *    de um nao pode apagar os outros. Um inventario que nao carrega nao pode
 *    levar junto o historico de consentimento, e vice-versa;
 *  - **nao duplicacao**: "quem pode ver" e respondido pelo bloco de
 *    compartilhamento que ja existe. O painel aponta para ele. Se um dia
 *    aparecer aqui um controle de permissao, existem duas fontes da verdade — e
 *    o teste reprova antes disso chegar na tela.
 */

const inventory = buildDataInventory(
  {
    emotional_checkins: [{}, {}, {}],
    sleep_records: [{}],
    journal_entries: [{}, {}],
    notifications: [{}],
  },
  ["audit_logs", "professional_notes"],
);

const evento = (overrides: Partial<ConsentEvent> = {}): ConsentEvent => ({
  id: "11111111-1111-4111-8111-111111111111",
  purpose: "ai_inference",
  documentVersion: "v1",
  eventType: "granted",
  occurredAt: "2026-09-01T10:00:00.000Z",
  grantedEventId: null,
  expiresAt: null,
  ...overrides,
});

const consents = buildConsentHistory([
  evento(),
  evento({
    id: "22222222-2222-4222-8222-222222222222",
    eventType: "revoked",
    grantedEventId: "11111111-1111-4111-8111-111111111111",
    occurredAt: "2026-09-05T10:00:00.000Z",
  }),
  evento({
    id: "33333333-3333-4333-8333-333333333333",
    purpose: "terms_privacy",
    occurredAt: "2026-08-01T09:00:00.000Z",
  }),
]);

afterEach(cleanup);

describe("o que existe sobre voce", () => {
  it("mostra contagem por dominio e o total", () => {
    render(<PrivacyPanel inventory={inventory} consents={consents} />);
    expect(screen.getByText("Registros emocionais")).toBeVisible();
    expect(screen.getByText("Total de 7 registro(s).", { exact: false })).toBeVisible();
  });

  it("declara o dominio vazio em vez de omiti-lo", () => {
    render(<PrivacyPanel inventory={inventory} consents={consents} />);
    // "Voce nao tem nada de ciclo" e uma resposta; a linha ausente nao seria.
    expect(screen.getByText(/Sem nenhum registro em:/)).toHaveTextContent("Ciclo");
  });

  it("declara o que ficou fora da contagem, e por que", () => {
    render(<PrivacyPanel inventory={inventory} consents={consents} />);
    const nota = screen.getByText(/Fora desta contagem/);
    expect(nota).toHaveTextContent("audit_logs");
    expect(nota).toHaveTextContent("professional_notes");
    expect(nota).toHaveTextContent("anotação clínica pertence ao profissional");
  });
});

describe("historico de consentimento", () => {
  it("mostra finalidade, estado derivado, versao e cada evento", () => {
    render(<PrivacyPanel inventory={inventory} consents={consents} />);

    /*
      A asserção e escopada ao item da finalidade, e nao ao documento inteiro:
      "versao v1" aparece uma vez por finalidade, e uma busca global passaria
      sem provar que o dado esta ao lado do consentimento certo.
    */
    const ia = screen.getByText("Interpretação por IA").closest("li");
    expect(ia).not.toBeNull();
    const item = within(ia as HTMLElement);

    // Concedido e depois revogado: o estado derivado diz "nao ativo", e os dois
    // eventos continuam visiveis. Revogar nao apaga a concessao.
    expect(item.getByText(/Não ativo/)).toBeVisible();
    expect(item.getByText(/versão v1/)).toBeVisible();
    expect(item.getByText(/Concedido em 01\/09\/2026/)).toBeVisible();
    expect(item.getByText(/Revogado em 05\/09\/2026/)).toBeVisible();

    const termos = screen.getByText("Termos e privacidade").closest("li");
    expect(within(termos as HTMLElement).getByText(/Ativo/)).toBeVisible();
  });

  it("declara as autorizacoes que nao vivem nesta linha do tempo", () => {
    render(<PrivacyPanel inventory={inventory} consents={consents} />);
    const bloco = within(screen.getByTestId("consent-elsewhere"));
    for (const item of CONSENT_ELSEWHERE) {
      expect(bloco.getByText(item.label)).toBeVisible();
      expect(bloco.getByText(item.whereToChange)).toBeVisible();
    }
  });

  it("nao duplica o controle de quem pode ver: aponta para o bloco existente", () => {
    render(<PrivacyPanel inventory={inventory} consents={consents} />);
    /*
      Nenhum switch de permissao nasce aqui — eles vivem em ProfessionalSharing.
      Se um dia aparecer um, existem duas fontes da verdade sobre quem ve o que,
      e elas divergem na primeira revogacao.
    */
    expect(screen.queryAllByRole("switch")).toEqual([]);
    expect(
      within(screen.getByTestId("privacy-how-to-change")).getByText(
        "Compartilhamento com profissional",
      ),
    ).toBeVisible();
  });
});

describe("degradacao por bloco", () => {
  it("inventario indisponivel nao derruba o historico", () => {
    render(
      <PrivacyPanel
        inventory={EMPTY_DATA_INVENTORY}
        consents={consents}
        inventoryUnavailable
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não foi possível carregar o inventário dos seus dados.",
    );
    // O outro bloco continua inteiro.
    expect(screen.getByText("Interpretação por IA")).toBeVisible();
  });

  it("historico indisponivel nao derruba o inventario", () => {
    render(
      <PrivacyPanel
        inventory={inventory}
        consents={EMPTY_CONSENT_HISTORY}
        consentsUnavailable
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não foi possível carregar seu histórico de consentimento.",
    );
    expect(screen.getByText("Registros emocionais")).toBeVisible();
  });

  it("conta sem consentimento registrado diz isso, e nao finge lista vazia", () => {
    render(
      <PrivacyPanel inventory={inventory} consents={EMPTY_CONSENT_HISTORY} />,
    );
    expect(
      screen.getByText("Ainda não há consentimento registrado nesta conta."),
    ).toBeVisible();
    // Mesmo sem eventos, o que e governado em outro lugar continua declarado.
    const bloco = screen.getByText(
      "Autorizações que não vivem nesta linha do tempo",
    ).parentElement as HTMLElement;
    expect(within(bloco).getByText(/Câmera, microfone/)).toBeVisible();
  });
});
