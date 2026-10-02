import { describe, expect, it, vi } from "vitest";

import {
  submitTranscriptCorrection,
  submitFeedback,
} from "./feedback-service";



interface Captured {
  table: string;
  op: string;
  payload?: Record<string, unknown>;
}

function fakeClient(
  transcript: Record<string, unknown> | null,
  /**
   * O que a busca do alvo encontra.
   *
   * `undefined` = a tabela devolve a propria linha (alvo valido). `null` = nao
   * ha linha com aquele id NAQUELA sessao e daquela pessoa - que e como um alvo
   * cruzado, de outra sessao ou inexistente aparece para o service.
   */
  targetLookup: Record<string, unknown> | null | undefined = undefined,
) {
  const captured: Captured[] = [];
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        is: () => builder,
        maybeSingle: async () => ({
          data:
            table === "session_transcripts" && targetLookup !== undefined
              ? targetLookup
              : table === "session_interpretations"
                ? (targetLookup ?? null)
                : transcript,
          error: null,
        }),
        single: async () => ({
          data: {
            id: "row",
            session_id: "session",
            user_id: "user",
            revision: 1,
            revoked_at: null,
            corrected_content: "corrigido",
            original_content: "original",
            training_eligible: false,
            created_at: "2026-09-09T12:00:00.000Z",
            updated_at: "2026-09-09T12:00:00.000Z",
            target_type: "transcription",
            rating: "positive",
            reason: null,
          },
          error: null,
        }),
        insert(payload: Record<string, unknown>) {
          captured.push({ table, op: "insert", payload });
          return builder;
        },
        upsert(payload: Record<string, unknown>) {
          captured.push({ table, op: "upsert", payload });
          return builder;
        },
        update(payload: Record<string, unknown>) {
          captured.push({ table, op: "update", payload });
          return builder;
        },
        delete() {
          captured.push({ table, op: "delete" });
          return builder;
        },
        then: undefined,
      };
      // As leituras de lista resolvem direto.
      (builder as { order: () => unknown }).order = () =>
        Object.assign(Promise.resolve({ data: [], error: null }), builder);
      return builder;
    },
  };
  return { client: client as never, captured };
}

const TRANSCRIPT = {
  id: "transcript-1",
  content: "eu consegui terminar",
  source: "local_whisper",
  status: "available",
};

describe("correcao humana", () => {
  it("NAO faz update no transcript original", async () => {
    /*
      ASR_ORIGINAL != USER_CORRECTION. Sobrescrever faria o sistema afirmar que
      o ASR produziu algo que ele nao produziu, e apagaria a evidencia do erro.
    */
    const { client, captured } = fakeClient(TRANSCRIPT);
    await submitTranscriptCorrection(client, "user", {
      sessionId: "11111111-1111-4111-8111-111111111111",
      correctedText: "eu nao consegui terminar",
    });

    const touchedTranscript = captured.filter(
      (entry) =>
        entry.table === "session_transcripts" && entry.op !== "select",
    );
    expect(touchedTranscript).toEqual([]);
  });

  it("guarda o original vindo do SERVIDOR, e nao do cliente", async () => {
    const { client, captured } = fakeClient(TRANSCRIPT);
    await submitTranscriptCorrection(client, "user", {
      sessionId: "11111111-1111-4111-8111-111111111111",
      correctedText: "eu nao consegui terminar",
    });

    const insert = captured.find(
      (entry) => entry.table === "transcript_corrections",
    );
    expect(insert?.payload?.original_content).toBe("eu consegui terminar");
    expect(insert?.payload?.original_source).toBe("local_whisper");
  });

  it("nunca marca a correcao como elegivel para treinamento", async () => {
    // FEEDBACK != TRAINING, escrito explicitamente no insert.
    const { client, captured } = fakeClient(TRANSCRIPT);
    await submitTranscriptCorrection(client, "user", {
      sessionId: "11111111-1111-4111-8111-111111111111",
      correctedText: "eu nao consegui terminar",
    });

    const insert = captured.find(
      (entry) => entry.table === "transcript_corrections",
    );
    expect(insert?.payload?.training_eligible).toBe(false);
  });

  it("texto identico nao vira correcao", async () => {
    const { client, captured } = fakeClient(TRANSCRIPT);
    const outcome = await submitTranscriptCorrection(client, "user", {
      sessionId: "11111111-1111-4111-8111-111111111111",
      correctedText: "eu consegui terminar",
    });
    expect(outcome.status).toBe("unchanged");
    expect(captured.some((entry) => entry.op === "insert")).toBe(false);
  });

  it("sem transcricao disponivel nao ha o que corrigir", async () => {
    // Criar uma "correcao" de texto inexistente inventaria uma fala que nunca
    // foi reconhecida.
    const { client } = fakeClient(null);
    const outcome = await submitTranscriptCorrection(client, "user", {
      sessionId: "11111111-1111-4111-8111-111111111111",
      correctedText: "qualquer coisa",
    });
    expect(outcome.status).toBe("no_transcript");
  });

  it("NAO reenvia nada ao Veltrix", async () => {
    /*
      Reanalisar em silencio gastaria uma chamada de IA que ninguem pediu e
      trocaria a interpretacao que a pessoa ja leu por outra, sem ela saber.
    */
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { client } = fakeClient(TRANSCRIPT);
    await submitTranscriptCorrection(client, "user", {
      sessionId: "11111111-1111-4111-8111-111111111111",
      correctedText: "eu nao consegui terminar",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("avaliacao", () => {
  it("a identidade gravada e a do servidor, e nao a do formulario", async () => {
    const { client, captured } = fakeClient(TRANSCRIPT);
    await submitFeedback(client, "user-do-servidor", {
      sessionId: "11111111-1111-4111-8111-111111111111",
      targetType: "transcription",
      targetId: null,
      rating: "negative",
      reason: "missing_word",
    });
    const upsert = captured.find((entry) => entry.table === "session_feedback");
    expect(upsert?.payload?.user_id).toBe("user-do-servidor");
  });

  it("NAO dispara reinterpretacao", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { client } = fakeClient(TRANSCRIPT);
    await submitFeedback(client, "user", {
      sessionId: "11111111-1111-4111-8111-111111111111",
      targetType: "interpretation",
      targetId: null,
      rating: "negative",
      reason: null,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("integridade do alvo", () => {
  const SESSION = "11111111-1111-4111-8111-111111111111";
  const TARGET = "22222222-2222-4222-8222-222222222222";

  it("aceita um alvo que existe na propria sessao", async () => {
    const { client, captured } = fakeClient(TRANSCRIPT, { id: TARGET });
    const outcome = await submitFeedback(client, "user", {
      sessionId: SESSION,
      targetType: "transcription",
      targetId: TARGET,
      rating: "positive",
      reason: null,
    });
    expect(outcome.status).toBe("saved");
    expect(captured.some((entry) => entry.table === "session_feedback")).toBe(true);
  });

  it("recusa um alvo que nao pertence a esta sessao", async () => {
    /*
      A RLS prova que a SESSAO e da pessoa, e nao prova nada sobre o alvo. Sem
      esta checagem dava para avaliar uma "transcricao" apontando para outra
      coisa - proveniencia falsa, que um dataset futuro herdaria sem saber.
    */
    const { client, captured } = fakeClient(TRANSCRIPT, null);
    const outcome = await submitFeedback(client, "user", {
      sessionId: SESSION,
      targetType: "transcription",
      targetId: TARGET,
      rating: "negative",
      reason: null,
    });
    expect(outcome.status).toBe("invalid_target");
    // E nada foi gravado: a recusa acontece ANTES da escrita.
    expect(captured.some((entry) => entry.table === "session_feedback")).toBe(false);
  });

  it("recusa alvo cruzado tambem para interpretacao", async () => {
    const { client } = fakeClient(TRANSCRIPT, null);
    const outcome = await submitFeedback(client, "user", {
      sessionId: SESSION,
      targetType: "interpretation",
      targetId: TARGET,
      rating: "negative",
      reason: null,
    });
    expect(outcome.status).toBe("invalid_target");
  });

  it("alvo nulo continua permitido, para representar retencao", async () => {
    // Ausencia declarada, e nao alvo inventado.
    const { client } = fakeClient(TRANSCRIPT);
    const outcome = await submitFeedback(client, "user", {
      sessionId: SESSION,
      targetType: "transcription",
      targetId: null,
      rating: "positive",
      reason: null,
    });
    expect(outcome.status).toBe("saved");
  });
});
