import type { SupabaseClient, User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/repositories/multimodal-repository", () => ({
  MultimodalRepositoryError: class MultimodalRepositoryError extends Error {},
  findMediaAsset: vi.fn(),
  updateMediaAsset: vi.fn(),
  deleteMediaAsset: vi.fn(),
  deleteSessionAssets: vi.fn(),
  findMultimodalSession: vi.fn(),
  findSessionAssets: vi.fn(),
  insertMediaAsset: vi.fn(),
  insertMultimodalSession: vi.fn(),
  insertProcessingJob: vi.fn(),
  listMultimodalSessions: vi.fn(),
  updateMultimodalSession: vi.fn(),
  updateProcessingJob: vi.fn(),
}));

import type { Database } from "@/lib/supabase/database.types";
import {
  deleteMediaAsset,
  findMediaAsset,
  updateMediaAsset,
  updateMultimodalSession,
} from "@/server/repositories/multimodal-repository";
import { deleteMultimodalAsset } from "@/server/services/multimodal-service";



const USER = { id: "22222222-2222-4222-8222-222222222222" } as User;
const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const PATH = `${USER.id}/multimodal/${SESSION_ID}/camera.webm`;

const asset = {
  id: ASSET_ID,
  session_id: SESSION_ID,
  user_id: USER.id,
  media_kind: "camera",
  storage_path: PATH,
  status: "stored",
  size_bytes: 1024,
  deleted_at: null,
};

const storage = {
  remove: vi.fn(),
  list: vi.fn(),
};

const client = {
  storage: { from: () => storage },
} as unknown as SupabaseClient<Database>;

describe("exclusao de gravacao isolada", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findMediaAsset).mockResolvedValue(asset as never);
    vi.mocked(updateMediaAsset).mockResolvedValue(asset as never);
    storage.remove.mockResolvedValue({ data: null, error: null });
    // Prefixo vazio depois da remocao: o objeto saiu de verdade.
    storage.list.mockResolvedValue({ data: [], error: null });
  });

  it("remove o objeto, confirma a ausencia e so entao apaga o metadado", async () => {
    const result = await deleteMultimodalAsset(client, USER, ASSET_ID);

    expect(storage.remove).toHaveBeenCalledWith([PATH]);
    expect(deleteMediaAsset).toHaveBeenCalledWith(client, ASSET_ID);
    expect(result).toEqual({
      id: ASSET_ID,
      sessionId: SESSION_ID,
      status: "deleted",
    });

    // A ordem importa: o metadado sai depois do binario.
    expect(
      vi.mocked(storage.remove).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(deleteMediaAsset).mock.invocationCallOrder[0] ?? 0);
  });

  it("a sessao nao e tocada: apagar gravacao nao e apagar sessao", async () => {
    await deleteMultimodalAsset(client, USER, ASSET_ID);
    expect(updateMultimodalSession).not.toHaveBeenCalled();
  });

  it("falha de Storage devolve o asset ao estado anterior e nao apaga a linha", async () => {
    storage.remove.mockResolvedValue({ data: null, error: { message: "boom" } });

    await expect(
      deleteMultimodalAsset(client, USER, ASSET_ID),
    ).rejects.toMatchObject({ code: "STORAGE_FAILED" });

    expect(deleteMediaAsset).not.toHaveBeenCalled();
    expect(updateMediaAsset).toHaveBeenLastCalledWith(client, ASSET_ID, {
      status: "stored",
      deleted_at: null,
    });
  });

  it("objeto ainda presente e erro, e nao exclusao declarada", async () => {

    storage.list.mockResolvedValue({
      data: [{ name: "camera.webm" }],
      error: null,
    });

    await expect(
      deleteMultimodalAsset(client, USER, ASSET_ID),
    ).rejects.toMatchObject({ code: "CLEANUP_INCOMPLETE" });

    expect(deleteMediaAsset).not.toHaveBeenCalled();
    expect(updateMediaAsset).toHaveBeenLastCalledWith(client, ASSET_ID, {
      status: "stored",
      deleted_at: null,
    });
  });

  it("asset inexistente nao chega ao Storage", async () => {
    vi.mocked(findMediaAsset).mockResolvedValue(null as never);

    await expect(
      deleteMultimodalAsset(client, USER, ASSET_ID),
    ).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });

    expect(storage.remove).not.toHaveBeenCalled();
    expect(updateMediaAsset).not.toHaveBeenCalled();
  });

  it("identificador malformado e recusado antes de qualquer leitura", async () => {
    await expect(
      deleteMultimodalAsset(client, USER, "nao-e-uuid"),
    ).rejects.toThrow();
    expect(findMediaAsset).not.toHaveBeenCalled();
  });
});
