import { describe, expect, it } from "vitest";

import {
  isProfessionalPortalPath,
  professionalHomeFor,
  professionalStateFrom,
  PROFESSIONAL_STATE_POLICY,
  PROFESSIONAL_STATES,
} from "./professional-state";
import { VERIFICATION_STATUSES } from "./professional-verification";

describe("maquina de estado profissional (F1)", () => {
  it("reconcilia cada status do banco com exatamente um estado", () => {
    expect(professionalStateFrom({ effectiveStatus: null, hasOnboardingDraft: false })).toBe("NO_PROFILE");
    expect(professionalStateFrom({ effectiveStatus: null, hasOnboardingDraft: true })).toBe("ONBOARDING");
    const mapped = Object.fromEntries(
      VERIFICATION_STATUSES.map((status) => [status, professionalStateFrom({ effectiveStatus: status, hasOnboardingDraft: true })]),
    );
    expect(mapped).toEqual({
      pending: "UNDER_AUTOMATED_REVIEW",
      under_review: "UNDER_AUTOMATED_REVIEW",
      verified: "VERIFIED",
      rejected: "REJECTED",
      suspended: "SUSPENDED",
      expired_review: "EXPIRED_REVIEW",
      needs_correction: "PENDING_CORRECTION",
    });
  });

  it("status desconhecido nunca vira VERIFIED", () => {
    expect(
      professionalStateFrom({ effectiveStatus: "admin" as never, hasOnboardingDraft: false }),
    ).not.toBe("VERIFIED");
  });

  it("so VERIFIED libera portal, descoberta, vinculos, agenda, sessoes, dashboard e perfil publico", () => {
    for (const state of PROFESSIONAL_STATES) {
      const policy = PROFESSIONAL_STATE_POLICY[state];
      const unlocked = [
        policy.discovery,
        policy.relationships,
        policy.agenda,
        policy.sessions,
        policy.dashboard,
        policy.publicProfile,
        policy.routes.includes("/pro"),
      ];
      expect(unlocked.every(Boolean), state).toBe(state === "VERIFIED");
      expect(unlocked.some(Boolean), state).toBe(state === "VERIFIED");
    }
  });

  it("CTA do /perfil por estado, com os textos exigidos", () => {
    const labels = Object.fromEntries(PROFESSIONAL_STATES.map((s) => [s, PROFESSIONAL_STATE_POLICY[s].cta?.label]));
    expect(labels).toEqual({
      NO_PROFILE: "Entrar como profissional",
      ONBOARDING: "Continuar cadastro profissional",
      UNDER_AUTOMATED_REVIEW: "Acompanhar verificação profissional",
      PENDING_CORRECTION: "Corrigir cadastro profissional",
      VERIFIED: "Ir para área profissional",
      REJECTED: "Revisar situação profissional",
      SUSPENDED: "Regularizar acesso profissional",
      EXPIRED_REVIEW: "Regularizar acesso profissional",
    });
  });

  it("nenhum CTA de estado nao verificado aponta para /pro", () => {
    for (const state of PROFESSIONAL_STATES.filter((s) => s !== "VERIFIED")) {
      expect(isProfessionalPortalPath(PROFESSIONAL_STATE_POLICY[state].cta?.href ?? ""), state).toBe(false);
      expect(isProfessionalPortalPath(professionalHomeFor(state)), state).toBe(false);
    }
    expect(professionalHomeFor("VERIFIED")).toBe("/pro/dashboard");
  });

  it("reconhece rotas do portal sem falso positivo", () => {
    expect(isProfessionalPortalPath("/pro")).toBe(true);
    expect(isProfessionalPortalPath("/pro/agenda")).toBe(true);
    expect(isProfessionalPortalPath("/profissionais")).toBe(false);
    expect(isProfessionalPortalPath("/area-profissional")).toBe(false);
  });
});
