import { describe, expect, it } from "vitest";

import {
  DELETION_CONFIRMATION_PHRASE,
  DELETION_STATUSES,
  EXPORT_SCHEMA_VERSION,
  accountDeletionRequestSchema,
  subjectDataExportSchema,
} from "@/lib/contracts/subject-rights";

function validExport(overrides: Record<string, unknown> = {}) {
  return {
    exportSchemaVersion: EXPORT_SCHEMA_VERSION,
    generatedAt: "2026-08-26T12:00:00.000Z",
    subjectId: "3f1b6f6e-0000-4000-8000-000000000000",
    excluded: [
      "professional_notes",
      "audit_logs",
      "account_deletions",
      "deletion_ledger",
    ],
    data: { journal_entries: [], goals: [] },
    ...overrides,
  };
}

describe("subjectDataExportSchema", () => {
  it("aceita uma exportacao valida", () => {
    expect(() => subjectDataExportSchema.parse(validExport())).not.toThrow();
  });

  it("exige versao de schema, para que o arquivo seja interpretavel depois", () => {
    expect(() =>
      subjectDataExportSchema.parse(
        validExport({ exportSchemaVersion: "outro/v9" }),
      ),
    ).toThrow();
  });

  it("exige que o arquivo declare o que ficou de fora", () => {
    // Uma exportacao silenciosamente incompleta e pior que uma recusa: a pessoa
    // acredita ter tudo.
    expect(() =>
      subjectDataExportSchema.parse(validExport({ excluded: [] })),
    ).toThrow();
  });

  it("exige identificacao do titular", () => {
    expect(() =>
      subjectDataExportSchema.parse(validExport({ subjectId: "nao-e-uuid" })),
    ).toThrow();
  });

  it("recusa campo extra na raiz", () => {
    expect(() =>
      subjectDataExportSchema.parse(validExport({ secret: "x" })),
    ).toThrow();
  });

  it("exige instante de geracao", () => {
    expect(() =>
      subjectDataExportSchema.parse(validExport({ generatedAt: "ontem" })),
    ).toThrow();
  });
});

describe("accountDeletionRequestSchema", () => {
  it("aceita a frase exata", () => {
    expect(() =>
      accountDeletionRequestSchema.parse({
        confirmation: DELETION_CONFIRMATION_PHRASE,
      }),
    ).not.toThrow();
  });

  it("recusa confirmacao ausente", () => {
    expect(() => accountDeletionRequestSchema.parse({})).toThrow();
  });

  it("recusa frase aproximada", () => {
    // Um segundo ato deliberado: repetir o metodo HTTP nao basta.
    for (const wrong of [
      "excluir minha conta",
      "EXCLUIR CONTA",
      "EXCLUIR MINHA CONTA ",
      "sim",
      "",
    ]) {
      expect(() =>
        accountDeletionRequestSchema.parse({ confirmation: wrong }),
      ).toThrow();
    }
  });

  it("recusa campo extra", () => {
    expect(() =>
      accountDeletionRequestSchema.parse({
        confirmation: DELETION_CONFIRMATION_PHRASE,
        force: true,
      }),
    ).toThrow();
  });
});

describe("lifecycle da exclusao", () => {
  it("cobre a ordem de etapas e o estado de falha", () => {
    expect([...DELETION_STATUSES]).toEqual([
      "requested",
      "learning_revoked",
      "storage_cleared",
      "domain_cleared",
      "failed",
    ]);
  });

  it("learning vem antes de Storage na ordem declarada", () => {
    // Revogar o candidato enquanto a origem ainda existe; so depois apagar a
    // midia, que nao cascateia.
    expect(DELETION_STATUSES.indexOf("learning_revoked")).toBeLessThan(
      DELETION_STATUSES.indexOf("storage_cleared"),
    );
  });

  it("Storage vem antes do dominio", () => {
    expect(DELETION_STATUSES.indexOf("storage_cleared")).toBeLessThan(
      DELETION_STATUSES.indexOf("domain_cleared"),
    );
  });
});
