import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMAIL_TEMPLATES } from "@/server/email/templates";
import { EmailTransportError, type EmailTransport } from "@/server/email/transport";
import {
  emailEventKey,
  sendNotificationEmail,
  sendTransactionalEmail,
} from "@/server/services/email-delivery-service";



const TRANSPORTE_LOCAL = {
  ELYRA_EMAIL_TRANSPORT: "local_capture",
  ELYRA_PUBLIC_APP_URL: "http://127.0.0.1:3000",
};
const DESTINATARIO = { email: "pessoa@elyra.invalid" };

const h = vi.hoisted(() => ({ rpc: vi.fn() }));

function client() {
  return { rpc: h.rpc } as unknown as Parameters<typeof sendNotificationEmail>[0];
}

function transporteQueFunciona(): EmailTransport & { enviadas: unknown[] } {
  const enviadas: unknown[] = [];
  return {
    kind: "local_capture",
    enviadas,
    async send(message) {
      enviadas.push(message);
    },
  };
}

function transporteQueFalha(reason = "http_500"): EmailTransport {
  return {
    kind: "brevo",
    async send() {
      throw new EmailTransportError(reason);
    },
  };
}

/** A chamada de liquidacao, como o servico a fez. */
function liquidacao() {
  return h.rpc.mock.calls.find(
    (call) => call[0] === "settle_notification_email",
  )?.[1] as { p_succeeded: boolean; p_failure_code?: string } | undefined;
}

beforeEach(() => {
  h.rpc.mockReset();
});

describe("sem transporte, nao ha entrega nem tentativa", () => {
  it("responde indisponivel e nao toca o banco", async () => {
    const resultado = await sendNotificationEmail(
      client(),
      DESTINATARIO,
      "checkin_reminder",
      { env: {} },
    );

    expect(resultado).toEqual({ status: "unavailable", reason: "transport_missing" });
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("o banco decide se deve entregar", () => {
  it("`null` da RPC vira supressao, e nao erro", async () => {
    /*
      Desligado, adiado, teto atingido e janela ja entregue chegam aqui como o
      mesmo `null` — de proposito. Distinguir os quatro no retorno faria alguem
      tratar "adiado" como falha e tentar de novo.
    */
    h.rpc.mockResolvedValueOnce({ data: null, error: null });

    const resultado = await sendNotificationEmail(
      client(),
      DESTINATARIO,
      "weekly_digest",
      { env: TRANSPORTE_LOCAL, transport: transporteQueFunciona() },
    );

    expect(resultado).toEqual({ status: "suppressed" });
    expect(liquidacao()).toBeUndefined();
  });

  it("supressao nao envia mensagem nenhuma", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: null });
    const transporte = transporteQueFunciona();

    await sendNotificationEmail(client(), DESTINATARIO, "goal_reminder", {
      env: TRANSPORTE_LOCAL,
      transport: transporte,
    });

    expect(transporte.enviadas).toEqual([]);
  });

  it("falha da RPC e erro real, e nao supressao", async () => {
    /*
      A distincao que mais importa deste arquivo. Suprimir e uma decisao da
      pessoa; uma falha de banco disfarcada de supressao esconderia indisponi-
      bilidade atras de uma preferencia que ninguem mudou.
    */
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    const resultado = await sendNotificationEmail(
      client(),
      DESTINATARIO,
      "checkin_reminder",
      { env: TRANSPORTE_LOCAL, transport: transporteQueFunciona() },
    );

    expect(resultado.status).toBe("failed");
    expect(resultado.status === "failed" && resultado.reason).toBe(
      "enqueue_failed",
    );
  });
});

describe("entrega", () => {
  it("entrega e liquida como sucesso", async () => {
    h.rpc
      .mockResolvedValueOnce({ data: "delivery-1", error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    const resultado = await sendNotificationEmail(
      client(),
      DESTINATARIO,
      "weekly_digest",
      { env: TRANSPORTE_LOCAL, transport: transporteQueFunciona() },
    );

    expect(resultado).toEqual({ status: "delivered", deliveryId: "delivery-1", attempts: 1 });
    expect(liquidacao()?.p_succeeded).toBe(true);
  });

  it("a mensagem e a do template, para o titular informado", async () => {
    h.rpc
      .mockResolvedValueOnce({ data: "delivery-2", error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const transporte = transporteQueFunciona();

    await sendNotificationEmail(client(), DESTINATARIO, "checkin_reminder", {
      env: TRANSPORTE_LOCAL,
      transport: transporte,
    });

    const enviada = transporte.enviadas[0] as {
      to: string;
      subject: string;
      body: string;
      html: string;
    };
    expect(enviada.to).toBe(DESTINATARIO.email);
    expect(enviada.subject).toBe(EMAIL_TEMPLATES.checkin_reminder.subject);
    // O texto puro continua sendo a fonte, e carrega o convite inteiro.
    expect(enviada.body).toContain(EMAIL_TEMPLATES.checkin_reminder.body);
    expect(enviada.body).toContain("http://127.0.0.1:3000/dashboard");
    expect(enviada.body).toContain("http://127.0.0.1:3000/notificacoes");
    // E o HTML e a mesma coisa, com a marca em volta — nunca informacao a mais.
    expect(enviada.html).toContain("Elyra");
    expect(enviada.html).toContain("http://127.0.0.1:3000/dashboard");
    expect(enviada.html).toContain("http://127.0.0.1:3000/notificacoes");
  });

  it("sem endereco publico declarado, recusa em vez de mandar link quebrado", async () => {
    const resultado = await sendNotificationEmail(
      client(),
      DESTINATARIO,
      "checkin_reminder",
      { env: { ELYRA_EMAIL_TRANSPORT: "local_capture" } },
    );

    expect(resultado).toEqual({ status: "unavailable", reason: "app_url_missing" });
    // Nem chegou ao banco: nao ha o que enfileirar se nao da para montar o convite.
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("falha de transporte nunca vira entrega", async () => {
    h.rpc
      .mockResolvedValueOnce({ data: "delivery-3", error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    const resultado = await sendNotificationEmail(
      client(),
      DESTINATARIO,
      "goal_reminder",
      { env: TRANSPORTE_LOCAL, transport: transporteQueFalha("http_502") },
    );

    expect(resultado.status).toBe("failed");
    expect(liquidacao()?.p_succeeded).toBe(false);
    expect(liquidacao()?.p_failure_code).toBe("http_502");
  });

  it("o motivo da falha nao carrega o endereco de destino", async () => {
    // Endereco em log ou em codigo de erro e dado pessoal onde nao precisa estar.
    h.rpc
      .mockResolvedValueOnce({ data: "delivery-4", error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    const resultado = await sendNotificationEmail(
      client(),
      DESTINATARIO,
      "goal_reminder",
      { env: TRANSPORTE_LOCAL, transport: transporteQueFalha() },
    );

    expect(JSON.stringify(resultado)).not.toContain("pessoa@elyra.invalid");
  });
});

describe("a janela vive na chave", () => {
  it("tipos diarios usam a data", () => {
    const chave = emailEventKey("checkin_reminder", new Date("2026-09-12T22:00:00Z"));
    expect(chave).toBe("checkin_reminder:2026-09-12");
  });

  it("o resumo semanal usa a semana ISO", () => {
    /*
      A forma e verificada, e nao um numero de semana calculado a mao: o que o
      teto de frequencia exige e que dias da MESMA semana produzam a MESMA
      chave, e semanas diferentes produzam chaves diferentes.
    */
    const segunda = emailEventKey("weekly_digest", new Date("2026-09-07T10:00:00Z"));
    const domingo = emailEventKey("weekly_digest", new Date("2026-09-13T10:00:00Z"));
    const proxima = emailEventKey("weekly_digest", new Date("2026-09-14T10:00:00Z"));

    expect(segunda).toMatch(/^weekly_digest:\d{4}-W\d{2}$/);
    expect(domingo).toBe(segunda);
    expect(proxima).not.toBe(segunda);
  });
});

describe("transacional nao consulta preferencia", () => {
  it("entrega sem tocar a matriz de notificacao", async () => {
    /*
      A regra que protege quem desligou tudo: desligar lembrete de metas nao
      pode impedir alguem de recuperar a propria senha. O caminho transacional
      nao chama RPC de preferencia nenhuma.
    */
    const transporte = transporteQueFunciona();
    const resultado = await sendTransactionalEmail(
      { to: DESTINATARIO.email, subject: "Sua senha", body: "Link interno." },
      { env: TRANSPORTE_LOCAL, transport: transporte },
    );

    expect(resultado).toEqual({ status: "delivered" });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(transporte.enviadas).toHaveLength(1);
  });

  it("sem transporte, responde indisponivel em vez de fingir envio", async () => {
    const resultado = await sendTransactionalEmail(
      { to: DESTINATARIO.email, subject: "x", body: "y" },
      { env: {} },
    );
    expect(resultado).toEqual({ status: "unavailable" });
  });
});

describe("retry: repetir o que e seguro, e so isso", () => {
  /** Transporte que falha nas primeiras `falhas` tentativas e depois entrega. */
  function transporteInstavel(falhas: number, reason: string) {
    const tentativas: number[] = [];
    let n = 0;
    return {
      tentativas,
      transporte: {
        kind: "brevo" as const,
        async send() {
          n += 1;
          tentativas.push(n);
          if (n <= falhas) throw new EmailTransportError(reason);
        },
      },
    };
  }

  it("falha transitoria e repetida, e a entrega acontece na tentativa seguinte", async () => {
    h.rpc
      .mockResolvedValueOnce({ data: "delivery-r1", error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const { tentativas, transporte } = transporteInstavel(1, "http_429");

    const resultado = await sendNotificationEmail(
      client(),
      DESTINATARIO,
      "checkin_reminder",
      { env: TRANSPORTE_LOCAL, transport: transporte, sleep: async () => {} },
    );

    expect(resultado).toEqual({
      status: "delivered",
      deliveryId: "delivery-r1",
      attempts: 2,
    });
    expect(tentativas).toEqual([1, 2]);
    // Sucesso depois de falhar continua sendo sucesso liquidado como tal.
    expect(liquidacao()?.p_succeeded).toBe(true);
  });

  it("timeout NAO e repetido: a mensagem pode ter saido", async () => {
    /*
      A regra que evita e-mail duplicado na caixa da pessoa. Sem resposta do
      provedor ninguem sabe se a mensagem saiu — entao tenta-se **uma** vez.
    */
    h.rpc
      .mockResolvedValueOnce({ data: "delivery-r2", error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const { tentativas, transporte } = transporteInstavel(99, "timeout");

    const resultado = await sendNotificationEmail(
      client(),
      DESTINATARIO,
      "checkin_reminder",
      { env: TRANSPORTE_LOCAL, transport: transporte, sleep: async () => {} },
    );

    expect(tentativas).toEqual([1]);
    expect(resultado).toMatchObject({
      status: "failed",
      failureClass: "UNKNOWN_DELIVERY",
      attempts: 1,
    });
  });

  it("recusa permanente nao gasta tentativa a toa", async () => {
    h.rpc
      .mockResolvedValueOnce({ data: "delivery-r3", error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    // 422 e o caso real de remetente ainda nao verificado no provedor.
    const { tentativas, transporte } = transporteInstavel(99, "http_422");

    const resultado = await sendNotificationEmail(
      client(),
      DESTINATARIO,
      "goal_reminder",
      { env: TRANSPORTE_LOCAL, transport: transporte, sleep: async () => {} },
    );

    expect(tentativas).toEqual([1]);
    expect(resultado).toMatchObject({
      status: "failed",
      failureClass: "PERMANENT_FAILURE",
      reason: "http_422",
    });
  });

  it("falha transitoria continua terminando: o retry nao vira laco", async () => {
    h.rpc
      .mockResolvedValueOnce({ data: "delivery-r4", error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const { tentativas, transporte } = transporteInstavel(99, "http_503");

    const resultado = await sendNotificationEmail(
      client(),
      DESTINATARIO,
      "weekly_digest",
      { env: TRANSPORTE_LOCAL, transport: transporte, sleep: async () => {} },
    );

    expect(tentativas).toEqual([1, 2, 3]);
    expect(resultado).toMatchObject({ status: "failed", attempts: 3 });
    // E a linha volta a poder ser tentada: falha nao carimba entrega.
    expect(liquidacao()?.p_succeeded).toBe(false);
    expect(liquidacao()?.p_failure_code).toBe("http_503");
  });
});
