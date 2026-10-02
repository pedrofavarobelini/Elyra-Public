import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getOwnAvailabilityWeek, getWeekSlots, updateOwnAvailabilityWeek } from "./appointment-service";
import { SchedulingRuleError } from "@/server/repositories/scheduling-repository";
import { schedulingErrorResponse } from "@/app/api/scheduling/response";

const week = { weekStart: "2026-10-05", timezone: "America/Sao_Paulo", published: true, revision: "a".repeat(32), intervals: [], blocks: [], slots: [], conflicts: [] };
function client(data: unknown = week, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { value: { rpc } as unknown as SupabaseClient<Database>, rpc };
}
describe("finite weekly scheduling service and repository", () => {
  it("reads only the authenticated owner's week, with no user id argument", async () => {
    const c = client();
    expect(await getOwnAvailabilityWeek(c.value, { weekStart: week.weekStart, timezone: week.timezone })).toEqual(week);
    expect(c.rpc).toHaveBeenCalledWith("get_professional_availability_week", { p_week_start: week.weekStart, p_timezone: week.timezone });
  });
  it.each(["publish", "edit", "block", "remove"])("%s is one atomic RPC and never modifies appointments", async (operation) => {
    const c = client();
    const intervals = operation === "remove" ? [] : [{ date: week.weekStart, startMinute: operation === "edit" ? 600 : 540, endMinute: 720, slotMinutes: 30, modality: "online" }];
    const blocks = operation === "block" ? [{ date: week.weekStart, startMinute: null, endMinute: null }] : [];
    await updateOwnAvailabilityWeek(c.value, { weekStart: week.weekStart, timezone: week.timezone, revision: week.revision, intervals, blocks });
    expect(c.rpc).toHaveBeenCalledTimes(1);
    expect(c.rpc).toHaveBeenCalledWith("save_professional_week_availability", expect.objectContaining({ p_week_start: week.weekStart, p_expected_revision: week.revision, p_intervals: expect.any(Array), p_blocks: expect.any(Array) }));
  });
  it.each([
    { weekStart: "2026-10-06" }, { weekStart: "2026-02-30" }, { timezone: "-03:00" },
    { professionalUserId: "29350000-0000-4000-8000-000000000012" },
    { intervals: [{ date: "2026-10-12", startMinute: 540, endMinute: 720, slotMinutes: 30, modality: "online" }] },
    { intervals: [{ date: "2026-10-05", startMinute: 540, endMinute: 720, slotMinutes: 15, modality: "online" }] },
    { blocks: [{ date: "2026-10-05", startMinute: null, endMinute: 720 }] },
    { intervals: [{ date: "2026-10-05", startMinute: 540, endMinute: 720, slotMinutes: 30, modality: "online" }, { date: "2026-10-05", startMinute: 600, endMinute: 780, slotMinutes: 60, modality: "in_person" }] },
  ])("rejects invalid or cross-user input before calling the database: %j", async (patch) => {
    const c = client();
    await expect(updateOwnAvailabilityWeek(c.value, { weekStart: week.weekStart, timezone: week.timezone, revision: week.revision, intervals: [], blocks: [], ...patch })).rejects.toThrow();
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it("preserves the concurrent revision conflict as HTTP 409", async () => {
    const c = client(null, { code: "40001", message: "week_changed" });
    try { await updateOwnAvailabilityWeek(c.value, { weekStart: week.weekStart, timezone: week.timezone, revision: week.revision, intervals: [], blocks: [] }); }
    catch (error) { expect(error).toBeInstanceOf(SchedulingRuleError); expect(schedulingErrorResponse(error).status).toBe(409); return; }
    throw new Error("Expected conflict");
  });
  it("personal slot query carries only the week and professional; no personal metadata", async () => {
    const c = client({ timezone: week.timezone, slots: [] });
    expect(await getWeekSlots(c.value, { professionalUserId: "29350000-0000-4000-8000-000000000011", weekStart: week.weekStart })).toEqual({ timezone: week.timezone, slots: [] });
    expect(c.rpc).toHaveBeenCalledWith("list_professional_week_slots", { p_professional_user_id: "29350000-0000-4000-8000-000000000011", p_week_start: week.weekStart });
  });
});
