import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DEFAULT_MAILPIT_URL,
  EmailTransportError,
  createEmailTransport,
  emailDeliveryAvailable,
  isCaptureTransport,
  mailpitBaseUrl,
} from "@/server/email/transport";

afterEach(() => vi.unstubAllGlobals());

describe("transporte mailpit (Stage 29-C)", () => {
  it("so aceita loopback: nunca vira relay aberto", () => {
    expect(mailpitBaseUrl({})).toBe(DEFAULT_MAILPIT_URL);
    expect(mailpitBaseUrl({ ELYRA_MAILPIT_URL: "http://localhost:8025" })).toBe("http://localhost:8025");
    expect(mailpitBaseUrl({ ELYRA_MAILPIT_URL: "http://mail.exemplo.com:8025" })).toBeNull();
    expect(mailpitBaseUrl({ ELYRA_MAILPIT_URL: "https://127.0.0.1:54384" })).toBeNull();
    expect(mailpitBaseUrl({ ELYRA_MAILPIT_URL: "nao e url" })).toBeNull();
    expect(emailDeliveryAvailable({ ELYRA_EMAIL_TRANSPORT: "mailpit", ELYRA_MAILPIT_URL: "http://10.0.0.5:1" })).toBe(false);
    expect(createEmailTransport({ ELYRA_EMAIL_TRANSPORT: "mailpit", ELYRA_MAILPIT_URL: "http://10.0.0.5:1" })).toBeNull();
  });

  it("envia pela API do Mailpit com texto e HTML", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const transport = createEmailTransport({ ELYRA_EMAIL_TRANSPORT: "mailpit" })!;
    await transport.send({ to: "p@example.invalid", subject: "S", body: "T", html: "<p>H</p>" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:54384/api/v1/send");
    expect(JSON.parse(String(init.body))).toMatchObject({
      To: [{ Email: "p@example.invalid" }],
      Subject: "S",
      Text: "T",
      HTML: "<p>H</p>",
    });
  });

  it("erro do Mailpit vira codigo curto", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 500 })));
    const transport = createEmailTransport({ ELYRA_EMAIL_TRANSPORT: "mailpit" })!;
    await expect(transport.send({ to: "a@b.c", subject: "s", body: "b" })).rejects.toEqual(
      new EmailTransportError("http_500"),
    );
  });

  it("captura nunca conta como envio real", () => {
    expect(isCaptureTransport("mailpit")).toBe(true);
    expect(isCaptureTransport("local_capture")).toBe(true);
    expect(isCaptureTransport("brevo")).toBe(false);
  });
});

describe("brevo exige remetente", () => {
  it("chave sem remetente nao e canal disponivel", () => {
    expect(emailDeliveryAvailable({ ELYRA_EMAIL_TRANSPORT: "brevo", BREVO_API_KEY: "k" })).toBe(false);
    expect(
      emailDeliveryAvailable({ ELYRA_EMAIL_TRANSPORT: "brevo", BREVO_API_KEY: "k", ELYRA_EMAIL_SENDER_ADDRESS: "r@example.invalid" }),
    ).toBe(true);
  });
});
