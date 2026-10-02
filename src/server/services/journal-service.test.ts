import type { SupabaseClient, User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/repositories/journal-repository", () => ({
  JournalRepositoryError: class JournalRepositoryError extends Error {
    constructor(public readonly operation: string) {
      super(operation);
      this.name = "JournalRepositoryError";
    }
  },
  createCustomJournalTag: vi.fn(),
  deleteJournalEntry: vi.fn(),
  findJournalEntry: vi.fn(),
  listJournalEntries: vi.fn(),
  listJournalEntryTagLinks: vi.fn(),
  listJournalTags: vi.fn(),
  persistJournalEntry: vi.fn(),
  purgeExpiredJournal: vi.fn(),
  setJournalTrashState: vi.fn(),
}));

import type { Database } from "@/lib/supabase/database.types";
import {
  deleteJournalEntry,
  JournalRepositoryError,
  listJournalEntryTagLinks,
  setJournalTrashState,
} from "@/server/repositories/journal-repository";
import {
  changeJournalTrashState,
  JournalEntryNotFoundError,
  permanentlyDeleteJournalEntry,
} from "@/server/services/journal-service";

const user = { id: "11111111-1111-4111-8111-111111111111" } as User;
const client = {} as SupabaseClient<Database>;
const entryId = "22222222-2222-4222-8222-222222222222";


describe("recusa de anotacao fora de alcance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listJournalEntryTagLinks).mockResolvedValue([]);
  });

  it("trata zero linhas afetadas como anotacao nao encontrada", async () => {
    vi.mocked(setJournalTrashState).mockResolvedValue(null);

    await expect(
      changeJournalTrashState(client, user, { id: entryId, action: "trash" }),
    ).rejects.toBeInstanceOf(JournalEntryNotFoundError);
  });

  it("nao revela se a anotacao existe e e de outra pessoa", async () => {
    vi.mocked(setJournalTrashState).mockResolvedValue(null);

    // A mesma mensagem para "nao existe" e para "existe e nao e sua". Um texto
    // que distinguisse os dois casos confirmaria o alvo a quem nao pode ve-lo.
    await expect(
      changeJournalTrashState(client, user, { id: entryId, action: "trash" }),
    ).rejects.toThrow("Anotação não encontrada.");
  });

  it("continua propagando falha real do banco como falha de repositorio", async () => {
    vi.mocked(setJournalTrashState).mockRejectedValue(
      new JournalRepositoryError("set_trash_state"),
    );

    await expect(
      changeJournalTrashState(client, user, { id: entryId, action: "trash" }),
    ).rejects.toBeInstanceOf(JournalRepositoryError);
  });

  it("aplica a mesma separacao a exclusao permanente", async () => {
    vi.mocked(deleteJournalEntry).mockResolvedValue(null);

    await expect(
      permanentlyDeleteJournalEntry(client, user, { id: entryId }),
    ).rejects.toBeInstanceOf(JournalEntryNotFoundError);
  });

  it("devolve o identificador quando a exclusao alcanca a propria anotacao", async () => {
    vi.mocked(deleteJournalEntry).mockResolvedValue(entryId);

    await expect(
      permanentlyDeleteJournalEntry(client, user, { id: entryId }),
    ).resolves.toEqual({ id: entryId });
  });
});
