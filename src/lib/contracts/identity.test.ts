import { describe, expect, it } from "vitest";

import {
  PRIMARY_GOALS,
  PRIMARY_GOAL_LABEL,
  initialsFromName,
  preferencesUpdateSchema,
  profileUpdateSchema,
} from "@/lib/contracts/identity";

describe("identity contracts", () => {
  it("normaliza nome e deriva iniciais sem expor o e-mail", () => {
    const result = profileUpdateSchema.parse({ displayName: "  Ana Maria  " });

    expect(result.displayName).toBe("Ana Maria");
    expect(initialsFromName(result.displayName)).toBe("AM");
  });

  it("recusa nome vazio e update de preferencias vazio", () => {
    expect(profileUpdateSchema.safeParse({ displayName: "   " }).success).toBe(false);
    expect(preferencesUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("aceita atualizacao parcial explicita de preferencias", () => {
    expect(preferencesUpdateSchema.parse({ checkinReminder: false })).toEqual({
      checkinReminder: false,
    });
  });

  it("mantem a ativacao multimodal separada das permissoes de captura", () => {
    expect(preferencesUpdateSchema.parse({ sessionsEnabled: true })).toEqual({
      sessionsEnabled: true,
    });
  });

  it("objetivo na Elyra aceita so o vocabulario fechado, e null limpa", () => {
    expect(preferencesUpdateSchema.parse({ primaryGoal: "sleep" })).toEqual({
      primaryGoal: "sleep",
    });
    expect(preferencesUpdateSchema.parse({ primaryGoal: null })).toEqual({
      primaryGoal: null,
    });
    // Texto livre nao entra: "Outro" nao abre campo digitavel.
    expect(
      preferencesUpdateSchema.safeParse({ primaryGoal: "me sinto ansiosa" }).success,
    ).toBe(false);
  });

  it("objetivos sao rotulos de preferencia, sem vocabulario clinico", () => {
    expect(Object.keys(PRIMARY_GOAL_LABEL).sort()).toEqual([...PRIMARY_GOALS].sort());
    for (const label of Object.values(PRIMARY_GOAL_LABEL)) {
      expect(label).not.toMatch(/diagn|tratamento|transtorno|sintoma|terapia/i);
    }
  });

  it("usa fallback seguro para nome sem caracteres", () => {
    expect(initialsFromName("   ")).toBe("?");
  });
});
