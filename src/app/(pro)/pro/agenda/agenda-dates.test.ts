import { describe, expect, it } from "vitest";

import { availabilityExceptionInputSchema } from "@/lib/contracts/scheduling";
import { addDaysToKey, blockLabel, describeException, exceptionCoversDay } from "./agenda-dates";

const base = {
  id: "00000000-0000-4000-8000-000000000001",
  timezone: "America/Sao_Paulo",
};

describe("datas da agenda profissional", () => {
  it("soma dias sem tropecar em virada de mes ou horario de verao", () => {
    expect(addDaysToKey("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysToKey("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("descreve bloqueio de periodo e abertura avulsa em texto", () => {
    const block = { ...base, kind: "block" as const, startsOn: "2026-10-12", endsOn: "2026-10-19", startMinute: null, endMinute: null, slotMinutes: null, modality: null };
    expect(describeException(block)).toContain("dia inteiro");
    expect(blockLabel(block)).toBe("Bloqueado o dia todo");
    expect(exceptionCoversDay(block, "2026-10-12")).toBe(true);
    expect(exceptionCoversDay(block, "2026-10-20")).toBe(false);
    const open = { ...base, kind: "open" as const, startsOn: "2026-10-04", endsOn: "2026-10-04", startMinute: 840, endMinute: 960, slotMinutes: 60 as const, modality: "online" as const };
    expect(describeException(open)).toMatch(/14:00–16:00 · 60 min · Online$/);
  });
});

describe("contrato de excecao", () => {
  const ok = {
    timezone: "America/Sao_Paulo",
    kind: "block",
    startsOn: "2026-10-12",
    endsOn: "2026-10-19",
    startMinute: null,
    endMinute: null,
    slotMinutes: null,
    modality: null,
  };

  it("aceita bloqueio de dia inteiro e abertura completa", () => {
    expect(availabilityExceptionInputSchema.safeParse(ok).success).toBe(true);
    expect(
      availabilityExceptionInputSchema.safeParse({
        ...ok, kind: "open", endsOn: "2026-10-12", startMinute: 840, endMinute: 960, slotMinutes: 60, modality: "online",
      }).success,
    ).toBe(true);
  });

  it("recusa texto livre, datas invertidas e abertura incompleta", () => {
    expect(availabilityExceptionInputSchema.safeParse({ ...ok, note: "ferias" }).success).toBe(false);
    expect(availabilityExceptionInputSchema.safeParse({ ...ok, endsOn: "2026-10-01" }).success).toBe(false);
    expect(availabilityExceptionInputSchema.safeParse({ ...ok, kind: "open" }).success).toBe(false);
    expect(availabilityExceptionInputSchema.safeParse({ ...ok, slotMinutes: 60 }).success).toBe(false);
    expect(availabilityExceptionInputSchema.safeParse({ ...ok, startMinute: 600 }).success).toBe(false);
    expect(availabilityExceptionInputSchema.safeParse({ ...ok, timezone: "UTC" }).success).toBe(false);
  });
});
