import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ASR_MODEL_ID,
  ASR_QA_COMPARATOR_MODEL_ID,
  LOCAL_WHISPER_PROVENANCE,
} from "@/lib/speech/browser-runtime";

/**
 * O experimento nao pode vazar para o produto.
 *
 * Os testes de comportamento provam que a comparacao mede certo. Estes provam
 * uma coisa diferente e igualmente necessaria: que ela nao **alcanca** nada.
 *
 * Sao asserções sobre a fonte, e nao sobre execucao, porque o vazamento que
 * importa e estrutural: um `import` do cliente do Veltrix dentro da arvore de
 * QA nao falha nenhum teste de comportamento — ele so espera a primeira pessoa
 * que resolver "aproveitar" a comparacao para pedir uma segunda opiniao.
 */

const ROOT = resolve(__dirname, "..", "..", "..");

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}


function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/(^|[^:])\/\/.*/gmu, "$1 ");
}

/** Toda a arvore da comparacao A/B. */
const AB_TREE = [
  "src/lib/speech/model-comparison.ts",
  "src/lib/qa/asr-ab-report.ts",
  "src/lib/qa/asr-ab-fixture.ts",
  "src/lib/qa/asr-ab-mode.ts",
  "src/lib/qa/asr-load-forensics.ts",
  "src/components/asr-model-comparison.tsx",
  "src/app/qa/asr-ab/page.tsx",
];

describe("isolamento da comparacao A/B", () => {
  it("G — o modelo padrao e o `small`, e o comparador e o `base`", () => {
    /*
      Trocado em 2026-09-10, depois do A/B fisico no Android. O `base` nao foi
      removido: ele continua sendo a linha de base contra a qual a proxima
      decisao de modelo vai medir.
    */
    expect(ASR_MODEL_ID).toBe("onnx-community/whisper-small");
    expect(ASR_QA_COMPARATOR_MODEL_ID).toBe("onnx-community/whisper-base");
    expect(ASR_MODEL_ID).not.toBe(ASR_QA_COMPARATOR_MODEL_ID);
  });

  it("G — a proveniencia gravada nas sessoes reais nomeia o modelo padrao", () => {
    /*
      Este e o campo que vai para o banco em toda transcricao. Se um dia ele
      passar a dizer `small` sem uma decisao humana registrada, transcricoes
      antigas e novas ficam com o mesmo nome de modelo e historicos diferentes.
    */
    expect(LOCAL_WHISPER_PROVENANCE.model).toBe(ASR_MODEL_ID);
  });

  it("G — nenhum caminho de produto menciona o comparador de QA", () => {
    const productPaths = [
      "src/lib/speech/local-model-engine.ts",
      "src/lib/speech/preparation.ts",
      "src/lib/speech/vad.ts",
      "src/lib/speech/segment-acceptance.ts",
      "src/app/(app)/sessoes/nova/capture-view.tsx",
      "src/app/(app)/sessoes/[id]/view.tsx",
    ];
    for (const path of productPaths) {
      /*
        O que o produto nao pode alcancar e o **comparador**, e nao um nome de
        modelo especifico. Quando o default trocou, esta assercao trocou de
        alvo junto — se ela tivesse continuado proibindo "whisper-small", teria
        passado a proibir o proprio modelo do produto.
      */
      expect(code(path), path).not.toContain("whisper-base");
      expect(code(path), path).not.toContain("ASR_QA_COMPARATOR_MODEL_ID");
      expect(code(path), path).not.toContain("compareAsrModels");
    }
  });

  it("H — a arvore de A/B nao alcanca o Veltrix", () => {
    for (const path of AB_TREE) {
      const text = code(path);
      expect(text, path).not.toContain("pedrocore");
      expect(text, path).not.toContain("PedroCore");
      expect(text, path).not.toContain("veltrix");
      expect(text, path).not.toContain("multimodal/v2");
    }
  });

  it("I — a arvore de A/B nao alcanca feedback, treinamento ou banco", () => {
    for (const path of AB_TREE) {
      const text = code(path);
      expect(text, path).not.toContain("feedback-service");
      expect(text, path).not.toContain("training_eligible");
      expect(text, path).not.toContain("transcript_corrections");
      expect(text, path).not.toContain("session_feedback");
      // Nenhum cliente de banco, em nenhuma das duas formas.
      expect(text, path).not.toContain("@/lib/supabase");
      expect(text, path).not.toContain("createClient");
    }
  });

  it("C — a arvore de A/B nao persiste em lugar nenhum", () => {
    for (const path of AB_TREE) {
      const text = code(path);
      /*
        Nem servidor, nem `localStorage`, nem `IndexedDB`.

        `sessionStorage` tambem nao: o diagnostico fisico do ASR usa, e usar
        aqui abriria a porta para alguem guardar "so o transcript" — que e a
        fala do Demo, so que com outro nome.
      */
      expect(text, path).not.toContain("localStorage");
      expect(text, path).not.toContain("sessionStorage");
      expect(text, path).not.toContain("indexedDB");
      expect(text, path).not.toMatch(/\bfetch\s*\(/u);
    }
  });

  it("J — a rota se recusa em producao, e por `notFound`", () => {
    const page = source("src/app/qa/asr-ab/page.tsx");
    expect(page).toContain("asrAbComparisonAllowed");
    expect(page).toContain("notFound()");
    /*
      `notFound`, e nao uma mensagem de acesso negado: uma pagina que anuncia a
      propria existencia em producao e uma pagina a menos de descobrir.
    */
    expect(page).not.toContain("Acesso negado");
  });

  it("J — a tela de comparacao nao e alcancavel pela navegacao do produto", () => {
    for (const path of [
      "src/app/(app)/sessoes/nova/capture-view.tsx",
      "src/app/(app)/sessoes/[id]/view.tsx",
    ]) {
      expect(source(path), path).not.toContain("/qa/asr-ab");
    }
  });
});

describe("o flag publico precisa ser lido como literal", () => {
  it("J — `asr-ab-mode` acessa a variavel pelo nome literal", () => {
    /*
      Regressao de um defeito real: a primeira versao lia
      `environment[ASR_AB_FLAG]`, o Next nao substituiu nada, e a tela de QA
      renderizou "indisponivel" num ambiente onde o flag estava ligado.

      O E2E pegou. Este teste existe para o proximo nao precisar do E2E.
    */
    const source = readFileSync(
      resolve(ROOT, "src/lib/qa/asr-ab-mode.ts"),
      "utf8",
    );
    expect(source).toContain("process.env.NEXT_PUBLIC_ASR_AB_COMPARISON");
  });
});

describe("o proprio filtro de comentarios precisa discriminar", () => {
  it("remove comentario, e preserva codigo", () => {
    /*
      Um filtro de comentario frouxo demais transformaria toda a suite de
      isolamento acima em teatro: bastaria ele engolir o arquivo inteiro para
      tudo passar. Entao ele e testado.
    */
    const text = code("src/components/asr-model-comparison.tsx");
    // O comentario que fala de `sessionStorage` sumiu...
    expect(text).not.toContain("sessionStorage");
    // ...e o codigo continua la.
    expect(text).toContain("compareAsrModels");
    expect(text).toContain("useCallback");
  });
});
