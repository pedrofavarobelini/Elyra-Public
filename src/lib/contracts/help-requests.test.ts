import { describe, expect, it } from "vitest";

import {
  allowedHelpRequestActions,
  HELP_REQUEST_COPY,
  HELP_REQUEST_ERROR_MESSAGE,
  HELP_REQUEST_POLICY,
  HELP_REQUEST_STATUS_LABEL,
  HELP_REQUEST_STATUSES,
  helpRequestActionSchema,
  helpRequestCreateSchema,
} from "./help-requests";
import { NOTIFICATION_COPY } from "./notifications";

const KEY = "3f1c0c9e-4e1b-4c55-9a53-7a6a3f0f7d11";
const CONNECTION = "0b8f5a8e-2f7a-4a52-8f0a-6c0d7a1e9b21";

describe("contrato de pedidos de ajuda (PRO-8)", () => {
  it("valida forma: texto aparado, 1-1000, sem campo extra", () => {
    expect(helpRequestCreateSchema.parse({ connectionId: CONNECTION, body: "  oi  ", idempotencyKey: KEY }).body).toBe("oi");
    expect(() => helpRequestCreateSchema.parse({ connectionId: CONNECTION, body: "   ", idempotencyKey: KEY })).toThrow();
    expect(() =>
      helpRequestCreateSchema.parse({ connectionId: CONNECTION, body: "a".repeat(1001), idempotencyKey: KEY }),
    ).toThrow();
    expect(() =>
      helpRequestCreateSchema.parse({ connectionId: CONNECTION, body: "oi", idempotencyKey: KEY, attachment: "x" }),
    ).toThrow();
  });

  it("nao existe acao de assumir nem de responder com texto", () => {
    expect(() => helpRequestActionSchema.parse({ action: "claim" })).toThrow();
    expect(() => helpRequestActionSchema.parse({ action: "reply" })).toThrow();
    expect(HELP_REQUEST_POLICY.professionalTextReply).toBe(false);
    expect(HELP_REQUEST_POLICY.attachments).toBe(false);
  });

  it("espelha as transicoes da RPC", () => {
    expect(allowedHelpRequestActions("client", "open")).toEqual(["cancel"]);
    expect(allowedHelpRequestActions("client", "seen")).toEqual(["close"]);
    expect(allowedHelpRequestActions("client", "responded")).toEqual(["close"]);
    expect(allowedHelpRequestActions("professional", "open")).toEqual(["seen", "responded"]);
    expect(allowedHelpRequestActions("professional", "seen")).toEqual(["responded", "close"]);
    expect(allowedHelpRequestActions("professional", "responded")).toEqual(["close"]);
    for (const terminal of ["closed", "cancelled", "expired"] as const) {
      expect(allowedHelpRequestActions("client", terminal)).toEqual([]);
      expect(allowedHelpRequestActions("professional", terminal)).toEqual([]);
    }
  });

  it("todo estado tem rotulo de fato, sem 'assumido' nem 'em atendimento'", () => {
    expect(Object.keys(HELP_REQUEST_STATUS_LABEL).sort()).toEqual([...HELP_REQUEST_STATUSES].sort());
    expect(JSON.stringify(HELP_REQUEST_STATUS_LABEL)).not.toMatch(/assumid|atendimento|em andamento/i);
  });

  it("a copy diz o limite e nao promete prazo, resposta ou socorro", () => {
    // L-398: uma linha so; a lista SAMU/CVV mora no SOS.
    expect(HELP_REQUEST_COPY.limit).toMatch(/não é um canal de emergência/);
    expect(HELP_REQUEST_COPY.limit).toMatch(/não há prazo de resposta/);
    expect(HELP_REQUEST_COPY.limit).toMatch(/Em risco imediato, use o botão SOS\./);
    // "Em risco imediato" descreve a situacao da pessoa (encaminha ao SOS); nunca uma promessa de resposta.
    const all = JSON.stringify({
      HELP_REQUEST_COPY,
      HELP_REQUEST_ERROR_MESSAGE,
      HELP_REQUEST_STATUS_LABEL,
      notif: [NOTIFICATION_COPY.help_request_received, NOTIFICATION_COPY.help_request_updated],
    }).replaceAll("Em risco imediato, use o botão SOS.", "");
    expect(all).not.toMatch(/(resposta|respond\w*) em (até )?\d|responderá|vai responder|garant|imediat|urgente|24 ?h por dia/i);
    expect(all).not.toMatch(/diagn|tratamento|transtorno|clínic|terapia/i);
  });

  it("aviso de pedido nao carrega a palavra 'ajuda' nem o texto", () => {
    for (const kind of ["help_request_received", "help_request_updated"] as const) {
      expect(JSON.stringify(NOTIFICATION_COPY[kind])).not.toMatch(/ajuda|socorro|crise/i);
    }
  });
});
