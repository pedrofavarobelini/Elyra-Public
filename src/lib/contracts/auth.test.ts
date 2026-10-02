import { describe, expect, it } from "vitest";

import { loginSchema, signupSchema } from "@/lib/contracts/auth";

describe("auth contracts", () => {
  const validSignup = {
    displayName: "Pessoa QA",
    email: "qa@example.test",
    password: "senha123",
    acceptedTerms: true,
  } as const;

  it("aceita cadastro explicito com termos e senha conforme politica", () => {
    expect(signupSchema.parse(validSignup)).toEqual(validSignup);
  });

  it.each(["12345678", "abcdefgh", "curta1"])(
    "recusa senha fora da politica: %s",
    (password) => {
      expect(signupSchema.safeParse({ ...validSignup, password }).success).toBe(false);
    },
  );

  it("recusa cadastro sem consentimento", () => {
    expect(
      signupSchema.safeParse({ ...validSignup, acceptedTerms: false }).success,
    ).toBe(false);
  });

  it("login nao revela se o e-mail existe no contrato", () => {
    expect(
      loginSchema.safeParse({ email: "not-an-email", password: "qualquer" }).success,
    ).toBe(false);
  });
});
