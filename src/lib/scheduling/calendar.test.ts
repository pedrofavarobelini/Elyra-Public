import { describe, expect, it } from "vitest";
import { addCivilDays, civilWeekStart, isCivilDate } from "./calendar";
describe("civil scheduling calendar", () => {
  it("rejects rolled-over impossible dates", () => { expect(isCivilDate("2026-02-30")).toBe(false); expect(isCivilDate("2024-02-29")).toBe(true); });
  it("civil weeks span month/year boundaries and DST without instant drift", () => { expect(civilWeekStart("2026-10-01")).toBe("2026-09-28"); expect(addCivilDays("2026-12-28", 6)).toBe("2027-01-03"); expect(addCivilDays("2026-11-01", 1)).toBe("2026-11-02"); });
});
