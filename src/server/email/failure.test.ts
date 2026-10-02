import { describe, expect, it } from "vitest";

import {
  EMAIL_FAILURE,
  MAX_TENTATIVAS,
  classificarFalha,
  esperaMs,
  formatarLogEntrega,
  haProximaTentativa,
  podeRepetir,
  statusDoReason,
} from "./failure";

/**
 * A regra dificil desta unidade nao e "tentar de novo quando falha" — e **nao**
 * tentar quando o desfecho e desconhecido. Os testes abaixo protegem
 * principalmente essa segunda metade, que e a contraintuitiva.
 */

describe("classificacao de falha", () => {
  it("o provedor pedindo espera e transitorio, e pode repetir", () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      const classe = classificarFalha(`http_${status}`);
      expect(classe, String(status)).toBe(EMAIL_FAILURE.TRANSIENT);
      expect(podeRepetir(classe), String(status)).toBe(true);
    }
  });

  it("recusa do provedor e permanente, e nao adianta repetir", () => {
    // 401 chave errada, 403 sem permissao, 400 payload, 422 remetente nao verificado.
    for (const status of [400, 401, 403, 404, 422]) {
      const classe = classificarFalha(`http_${status}`);
      expect(classe, String(status)).toBe(EMAIL_FAILURE.PERMANENT);
      expect(podeRepetir(classe), String(status)).toBe(false);
    }
  });

  it("sem resposta do provedor, o desfecho e DESCONHECIDO — e nao se repete", () => {
    /*
      O ponto do modulo inteiro. Timeout parece transitorio, mas a mensagem pode
      ter saido: repetir duplicaria e-mail na caixa da pessoa.
    */
    for (const reason of ["timeout", "network_error"]) {
      const classe = classificarFalha(reason);
      expect(classe, reason).toBe(EMAIL_FAILURE.UNKNOWN_DELIVERY);
      expect(podeRepetir(classe), reason).toBe(false);
    }
  });

  it("configuracao ausente e classe propria, nao falha de entrega", () => {
    expect(classificarFalha("configuration_missing")).toBe(
      EMAIL_FAILURE.CONFIGURATION_MISSING,
    );
    expect(podeRepetir(EMAIL_FAILURE.CONFIGURATION_MISSING)).toBe(false);
  });

  it("motivo desconhecido nao vira permissao para repetir", () => {
    // Fail-closed: o que ninguem classificou nao ganha nova tentativa.
    expect(classificarFalha("transport_error")).toBe(EMAIL_FAILURE.PERMANENT);
    expect(classificarFalha("")).toBe(EMAIL_FAILURE.PERMANENT);
  });

  it("statusDoReason so aceita o formato curto", () => {
    expect(statusDoReason("http_429")).toBe(429);
    expect(statusDoReason("http_4290")).toBeNull();
    expect(statusDoReason("timeout")).toBeNull();
  });
});

describe("politica de tentativas", () => {
  it("termina: a ultima tentativa nao tem proxima", () => {
    expect(haProximaTentativa(MAX_TENTATIVAS - 1)).toBe(true);
    expect(haProximaTentativa(MAX_TENTATIVAS)).toBe(false);
  });

  it("a espera cresce, e continua curta o suficiente para nao segurar ninguem", () => {
    expect(esperaMs(1)).toBe(200);
    expect(esperaMs(2)).toBe(400);
    // O total de espera nao pode virar uma pausa perceptivel na acao da pessoa.
    const total = esperaMs(1) + esperaMs(2);
    expect(total).toBeLessThan(1000);
  });
});

describe("log de entrega", () => {
  it("carrega o que serve para operar", () => {
    const linha = formatarLogEntrega({
      event: "checkin_reminder",
      provider: "brevo",
      status: "TRANSIENT_FAILURE",
      code: "http_429",
      attempt: 2,
      correlationId: "delivery-7",
    });
    expect(linha).toBe(
      "email_delivery event=checkin_reminder provider=brevo status=TRANSIENT_FAILURE code=http_429 attempt=2 correlation=delivery-7",
    );
  });

  it("codigo fora do formato curto e descartado, nao impresso", () => {
    /*
      A mensagem do provedor pode ecoar o endereco de destino. O formato recusa
      qualquer coisa que nao seja codigo curto, em vez de confiar em quem chama.
    */
    const linha = formatarLogEntrega({
      event: "weekly_digest",
      provider: "brevo",
      status: "PERMANENT_FAILURE",
      code: "Invalid recipient: pessoa@example.invalid",
    });
    expect(linha).toContain("code=sanitized");
    expect(linha).not.toContain("pessoa@example.invalid");
  });

  it("o tipo nao tem onde guardar destinatario, assunto ou chave", () => {
    // Prova estrutural: os campos sensiveis nao existem no formato.
    const linha = formatarLogEntrega({
      event: "system_notice",
      provider: "local_capture",
      status: "delivered",
    });
    expect(linha).toBe(
      "email_delivery event=system_notice provider=local_capture status=delivered",
    );
  });
});
