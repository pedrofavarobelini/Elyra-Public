import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { professionalInviteEnvironment } from "./professional-invite-environment";
import { previewProfessionalInvite } from "./repositories/professional-repository";

describe("invite environment isolation", () => {
  it.each([
    [{ NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54381" }, "local"],
    [{ NODE_ENV: "production", ELYRA_RUNTIME_ENV: "qa", NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54381" }, "local"],
    [{ NODE_ENV: "production", ELYRA_RUNTIME_ENV: "staging", NEXT_PUBLIC_SUPABASE_URL: "https://qa.invalid" }, "staging"],
    [{ NODE_ENV: "production", ELYRA_RUNTIME_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://qa.invalid" }, null],
    [{ NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: "https://qa.invalid" }, null],
  ] as const)("shows only the appropriate hint for configured environment", (env, hint) => { expect(professionalInviteEnvironment(env)).toBe(hint); });
  it("an invite in database A is resolved only through client A; client B has no fallback", async () => {
    const rpcA = vi.fn().mockResolvedValue({ data: [{ professional_display_name: "QA A" }], error: null });
    const rpcB = vi.fn().mockResolvedValue({ data: [], error: null });
    const a = { rpc: rpcA } as unknown as SupabaseClient<Database>;
    const b = { rpc: rpcB } as unknown as SupabaseClient<Database>;
    expect(await previewProfessionalInvite(a, "ELY-00000-00000")).not.toBeNull();
    expect(await previewProfessionalInvite(b, "ELY-00000-00000")).toBeNull();
    expect(rpcA).toHaveBeenCalledTimes(1); expect(rpcB).toHaveBeenCalledTimes(1);
    expect(rpcB.mock.calls[0]?.[0]).toBe("preview_professional_invite");
  });
});
