import type { SupabaseClient, User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/repositories/multimodal-repository");
vi.mock("@/server/auth", () => ({
  getConsentedApiUser: vi.fn(),
  getAuthenticatedApiUser: vi.fn(),
  getAuthenticatedUser: vi.fn(),
}));
vi.mock("@/server/services/learning-service", () => ({ revokeLearningExport: vi.fn() }));
vi.mock("@/lib/security/rate-limit", () => ({
  consumeRateLimit: () => ({ allowed: true }),
  rateLimitIdentity: () => "test",
  rateLimitedResponse: vi.fn(),
}));

import type { Database } from "@/lib/supabase/database.types";
import * as repository from "@/server/repositories/multimodal-repository";
import { getAuthenticatedApiUser, getAuthenticatedUser, getConsentedApiUser } from "@/server/auth";
import { DELETE as deleteSession, PATCH as patchSession } from "@/app/api/multimodal/sessions/[id]/route";
import { DELETE as deleteAsset } from "@/app/api/multimodal/assets/[id]/route";
import { DELETE as deleteAccount } from "@/app/api/me/account/route";
import { deleteAccountAndData } from "@/server/services/subject-rights-service";
import { revokeLearningExport } from "@/server/services/learning-service";
import { PROTECTED_QA_EVIDENCE_IDS, PROTECTED_QA_OWNER_IDS } from "./protected-evidence";

const disposableOwner = "22222222-2222-4222-8222-222222222222";
const disposableSession = "33333333-3333-4333-8333-333333333333";
const assetId = "11111111-1111-4111-8111-111111111111";
const storage = { remove: vi.fn(), list: vi.fn() };
const from = vi.fn();
const rpc = vi.fn();
const signOut = vi.fn();
const client = { from, rpc, storage: { from: vi.fn(() => storage) }, auth: { signOut } } as unknown as SupabaseClient<Database>;
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const request = () => new Request("http://localhost/api", { method: "DELETE" });

function session(owner = disposableOwner, id = disposableSession) {
  vi.mocked(repository.findMultimodalSession).mockResolvedValue({
    id, user_id: owner, status: "completed", ended_at: "2026-09-11T00:00:00Z",
  } as never);
  const user = { id: owner } as User;
  vi.mocked(getConsentedApiUser).mockResolvedValue({ auth: { supabase: client, user }, denial: null } as never);
  vi.mocked(getAuthenticatedApiUser).mockResolvedValue({ auth: { supabase: client, user }, denial: null } as never);
  vi.mocked(getAuthenticatedUser).mockResolvedValue({ supabase: client, user } as never);
}

function noMutation() {
  for (const fn of [repository.cancelActiveSessionJobs, repository.insertProcessingJob,
    repository.updateMultimodalSession, repository.updateMediaAsset,
    repository.deleteMediaAsset, repository.deleteSessionAssets,
    repository.updateProcessingJob, storage.remove, from, rpc, revokeLearningExport, signOut]) {
    expect(fn).not.toHaveBeenCalled();
  }
}

describe("L-171: protected evidence at the HTTP/service boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.list.mockResolvedValue({ data: [], error: null });
    storage.remove.mockResolvedValue({ data: null, error: null });
    vi.mocked(repository.findSessionAssets).mockResolvedValue([]);
    vi.mocked(repository.insertProcessingJob).mockResolvedValue({ id: assetId } as never);
    session();
  });

  it.each(PROTECTED_QA_EVIDENCE_IDS)("blocks DELETE of protected session %s before any mutation", async (id) => {
    session(PROTECTED_QA_OWNER_IDS[0], id);
    const response = await deleteSession(request(), context(id));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "PROTECTED_QA_EVIDENCE" });
    noMutation();
  });

  it("keeps protection if the evidence owner changes", async () => {
    const id = PROTECTED_QA_EVIDENCE_IDS[0]!;
    session(disposableOwner, id);
    expect((await deleteSession(request(), context(id))).status).toBe(409);
    noMutation();
  });

  it("preserves ownership denial without disclosing protection", async () => {
    const id = PROTECTED_QA_EVIDENCE_IDS[0]!;
    session(disposableOwner, id);
    vi.mocked(repository.findMultimodalSession).mockResolvedValue({ id, user_id: PROTECTED_QA_OWNER_IDS[0] } as never);
    expect((await deleteSession(request(), context(id))).status).toBe(404);
    noMutation();
  });

  it("blocks status changes to the protected session", async () => {
    const id = PROTECTED_QA_EVIDENCE_IDS[0]!;
    session(PROTECTED_QA_OWNER_IDS[0], id);
    const response = await patchSession(new Request("http://localhost/api", {
      method: "PATCH", body: JSON.stringify({ status: "cancelled" }),
    }), context(id));
    expect(response.status).toBe(409);
    noMutation();
  });

  it("blocks isolated media deletion before marking metadata or touching Storage", async () => {
    vi.mocked(repository.findMediaAsset).mockResolvedValue({
      id: assetId, session_id: PROTECTED_QA_EVIDENCE_IDS[0], user_id: disposableOwner, status: "stored",
    } as never);
    expect((await deleteAsset(request(), context(assetId))).status).toBe(409);
    noMutation();
  });

  it.each(PROTECTED_QA_OWNER_IDS)("blocks account cascade for protected owner %s", async (id) => {
    await expect(deleteAccountAndData(client, { id } as User)).rejects.toMatchObject({ code: "PROTECTED_QA_EVIDENCE" });
    noMutation();
  });

  it("returns HTTP 409 for account cascade instead of signing out or partially deleting", async () => {
    session(PROTECTED_QA_OWNER_IDS[0]);
    const response = await deleteAccount(new Request("http://localhost/api", {
      method: "DELETE", body: JSON.stringify({ confirmation: "EXCLUIR MINHA CONTA" }),
    }));
    expect(response.status).toBe(409);
    noMutation();
  });

  it("allows disposable session deletion through the existing verified cleanup", async () => {
    const response = await deleteSession(request(), context(disposableSession));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { id: disposableSession, status: "deleted" } });
    expect(repository.deleteSessionAssets).toHaveBeenCalledWith(client, disposableSession);
    expect(repository.updateMultimodalSession).toHaveBeenLastCalledWith(client, disposableSession, expect.objectContaining({ status: "deleted" }));
  });

  it("allows disposable media deletion and preserves its session", async () => {
    const path = disposableOwner + "/multimodal/" + disposableSession + "/microphone.webm";
    vi.mocked(repository.findMediaAsset).mockResolvedValue({
      id: assetId, session_id: disposableSession, user_id: disposableOwner, storage_path: path, status: "stored",
    } as never);
    expect((await deleteAsset(request(), context(assetId))).status).toBe(200);
    expect(storage.remove).toHaveBeenCalledWith([path]);
    expect(repository.deleteMediaAsset).toHaveBeenCalledWith(client, assetId);
    expect(repository.updateMultimodalSession).not.toHaveBeenCalled();
  });
});
