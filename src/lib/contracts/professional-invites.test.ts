import { describe, expect, it } from "vitest";

import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_ENTROPY_BITS,
  INVITE_CODE_PATTERN,
  INVITE_STATE_LABEL,
  INVITE_STATES,
  inviteAcceptedMessage,
  inviteLink,
  inviteRedeemInputSchema,
  isShortInviteCode,
  normalizeInviteCode,
  tokenFromHash,
} from "./professional-invites";

const LEGACY = "A".repeat(20) + "b-_".repeat(7) + "12";
const CODE = "ELY-8K4M2-9QXZ1";

describe("codigo de convite: formato e entropia", () => {
  it("alfabeto Crockford: 32 simbolos, sem I L O U, sem repeticao", () => {
    expect(INVITE_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(INVITE_CODE_ALPHABET).size).toBe(32);
    for (const ambiguous of ["I", "L", "O", "U"]) expect(INVITE_CODE_ALPHABET).not.toContain(ambiguous);
  });

  it("50 bits: 10 simbolos de 5 bits", () => {
    expect(INVITE_CODE_ENTROPY_BITS).toBe(50);
  });

  it("forma canonica ELY-XXXXX-XXXXX", () => {
    expect(INVITE_CODE_PATTERN.test(CODE)).toBe(true);
    expect(isShortInviteCode("ELY-8K4M2-9QXZU")).toBe(false);
    expect(isShortInviteCode("ELY-8K4M29QXZ1")).toBe(false);
    // O prefixo nunca colide com a parte aleatoria: `L` nao existe no alfabeto.
    expect(INVITE_CODE_ALPHABET).not.toContain("L");
  });
});

describe("codigo de convite: normalizacao", () => {
  it.each([
    ["ELY-8K4M2-9QXZ1"],
    ["ely-8k4m2-9qxz1"],
    ["  ELY-8K4M2-9QXZ1  "],
    ["ELY8K4M29QXZ1"],
    ["8K4M2-9QXZ1"],
    ["8k4m29qxz1"],
    ["ELY 8K4M2 9QXZ1"],
  ])("%s vira a forma canonica", (input) => {
    expect(normalizeInviteCode(input)).toBe(CODE);
  });

  it("O/I/L (fora do alfabeto) sao lidos como 0/1/1", () => {
    expect(normalizeInviteCode("ELY-O0IL1-AAAAA")).toBe("ELY-00111-AAAAA");
  });

  it("nenhum codigo valido e reescrito em outro", () => {
    for (let i = 0; i < 500; i += 1) {
      const symbols = Array.from({ length: 10 }, () => INVITE_CODE_ALPHABET[Math.floor(Math.random() * 32)]).join("");
      const code = `ELY-${symbols.slice(0, 5)}-${symbols.slice(5)}`;
      expect(normalizeInviteCode(code)).toBe(code);
      expect(normalizeInviteCode(code.toLowerCase())).toBe(code);
    }
  });

  it.each([
    ["ELY-8K4M2-9QXZU"], // U nao existe
    ["ELY-8K4M2-9QXZ"], // curto
    ["ELY-8K4M2-9QXZ12"], // longo
    ["XLY-8K4M2-9QXZ1"], // prefixo errado com 13 simbolos
    ["ELY-8K4M2-9QX#1"],
    [""],
    ["   "],
    ["A".repeat(33)],
  ])("%s e recusado", (input) => {
    expect(normalizeInviteCode(input)).toBeNull();
  });

  it("transicao: token longo do PRO-2 passa intacto (caixa preservada)", () => {
    expect(LEGACY).toHaveLength(43);
    expect(normalizeInviteCode(LEGACY)).toBe(LEGACY);
    expect(normalizeInviteCode(` ${LEGACY} `)).toBe(LEGACY);
  });
});

describe("codigo de convite: link e resgate", () => {
  it("codigo no fragmento, nunca em query ou path", () => {
    const link = inviteLink("https://elyra.local/", CODE);
    expect(link).toBe(`https://elyra.local/convite#${CODE}`);
    const url = new URL(link);
    expect(url.search).toBe("");
    expect(url.pathname).toBe("/convite");
  });

  it("le somente codigo bem formado do fragmento", () => {
    expect(tokenFromHash(`#${CODE}`)).toBe(CODE);
    expect(tokenFromHash(`#${encodeURIComponent(CODE.toLowerCase())}`)).toBe(CODE);
    expect(tokenFromHash(`#${LEGACY}`)).toBe(LEGACY);
    expect(tokenFromHash("#curto")).toBeNull();
    expect(tokenFromHash(`#${CODE}<script>`)).toBeNull();
    expect(tokenFromHash("#%E0%A4%A")).toBeNull();
    expect(tokenFromHash("")).toBeNull();
  });

  it("pedido de resgate e estrito e chega normalizado", () => {
    const parsed = inviteRedeemInputSchema.safeParse({ token: " ely8k4m29qxz1 ", action: "accept" });
    expect(parsed.success && parsed.data.token).toBe(CODE);
    expect(inviteRedeemInputSchema.safeParse({ token: LEGACY, action: "preview" }).success).toBe(true);
    expect(inviteRedeemInputSchema.safeParse({ token: CODE, action: "grant" }).success).toBe(false);
    expect(inviteRedeemInputSchema.safeParse({ token: CODE, action: "accept", scope: "emotional" }).success).toBe(false);
    expect(inviteRedeemInputSchema.safeParse({ token: "x".repeat(44), action: "accept" }).success).toBe(false);
  });
});

describe("codigo de convite: estados e texto", () => {
  it("todo estado tem rotulo; revogado aparece como Cancelado", () => {
    for (const state of INVITE_STATES) expect(INVITE_STATE_LABEL[state]).toBeTruthy();
    expect(INVITE_STATE_LABEL.revoked).toBe("Cancelado");
    expect(Object.values(INVITE_STATE_LABEL).join(" ")).not.toMatch(/token|revog/i);
  });

  it("depois do aceite: nunca diz 'criado' e sempre diz que nada foi compartilhado", () => {
    expect(inviteAcceptedMessage("created", "active", "Helena")).toBe(
      "Você está conectado com Helena. Nada foi compartilhado.",
    );
    expect(inviteAcceptedMessage("already_accepted", "active", "Helena")).toContain("conectado com Helena");
    expect(inviteAcceptedMessage("already_active", "active", "Helena")).toContain("já estava conectado");
    expect(inviteAcceptedMessage("already_paused", "paused", "Helena")).toContain("continua pausado");
    expect(inviteAcceptedMessage("already_accepted", "revoked", "Helena")).toBe(
      "Você já usou este convite, e o vínculo não está ativo.",
    );
    for (const outcome of ["created", "activated", "already_active", "already_accepted"] as const) {
      expect(inviteAcceptedMessage(outcome, "active", "X")).not.toMatch(/criad/i);
    }
  });
});
