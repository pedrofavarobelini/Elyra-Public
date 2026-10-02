import { describe, expect, it } from "vitest";

import {
  LEXICO_ACENTUADO,
  REGRA_COPY,
  auditarCopyDeTela,
  auditarRotuloDeCatalogo,
  semAcento,
} from "./vocabulary";

/**
 * O gate de vocabulario precisa provar duas coisas opostas: que reprova o erro
 * real e que **nao** reprova o texto correto. Um gate que so prova a primeira
 * metade vira ruido e acaba desligado — foi assim que a copy do banco escapou
 * da varredura na V1.
 */

describe("acentuacao em rotulo de catalogo", () => {
  it("reprova os 12 rotulos como foram semeados na origem", () => {

    const semeados = [
      "Exercicio",
      "Familia",
      "Saude",
      "Financas",
      "Gratidao",
      "Reflexao",
      "Relacoes",
      "Colica",
      "Dor de cabeca",
      "Cansaco",
      "Inchaco",
      "Alteracao de apetite",
    ];
    for (const rotulo of semeados) {
      const achados = auditarRotuloDeCatalogo(rotulo);
      expect(achados.map((a) => a.regra), rotulo).toContain(REGRA_COPY.ACENTO);
    }
  });

  it("aprova os mesmos rotulos depois da correcao", () => {
    const corrigidos = [
      "Exercício",
      "Família",
      "Saúde",
      "Finanças",
      "Gratidão",
      "Reflexão",
      "Relações",
      "Cólica",
      "Dor de cabeça",
      "Cansaço",
      "Inchaço",
      "Alteração de apetite",
    ];
    for (const rotulo of corrigidos) {
      expect(auditarRotuloDeCatalogo(rotulo), rotulo).toEqual([]);
    }
  });

  it("pega palavra que a lista ainda nao conhece, pelo sufixo que sempre acentua", () => {
    // O caso que escapou na V1: rotulo novo, fora do lexico.
    const achado = auditarRotuloDeCatalogo("Concentracao")[0];
    expect(achado?.regra).toBe(REGRA_COPY.ACENTO);
    expect(achado?.sugestao).toBe("Concentração");

    expect(auditarRotuloDeCatalogo("Emocoes")[0]?.sugestao).toBe("Emoções");
    expect(auditarRotuloDeCatalogo("Ansiedade percebida")).toEqual([]);
  });

  it("nao reprova rotulo curto e correto sem acento", () => {
    for (const rotulo of ["Trabalho", "Estudos", "Sono", "Vida social", "Sensibilidade"]) {
      expect(auditarRotuloDeCatalogo(rotulo), rotulo).toEqual([]);
    }
  });
});

describe("vocabulario proibido", () => {
  it("rotulo de catalogo nao carrega termo clinico nem de implementacao", () => {
    expect(auditarRotuloDeCatalogo("Transtorno de humor").map((a) => a.regra)).toContain(
      REGRA_COPY.CLINICO,
    );
    expect(auditarRotuloDeCatalogo("Sem dado persistido").map((a) => a.regra)).toContain(
      REGRA_COPY.INTERNO,
    );
  });

  it("copy de tela reprova condicao clinica e afirmacao de causa", () => {
    expect(auditarCopyDeTela("o quadro clínico indica").map((a) => a.regra)).toContain(
      REGRA_COPY.CLINICO,
    );
    expect(auditarCopyDeTela("dormir pouco causou a queda").map((a) => a.regra)).toContain(
      REGRA_COPY.CAUSAL,
    );
  });

  it("copy correta da Elyra passa", () => {
    expect(
      auditarCopyDeTela(
        "Registros aparecem juntos com frequência. Isso não indica causa.",
      ),
    ).toEqual([]);
    // O nome correto da metrica nao pode ser reprovado pela palavra "ansiedade".
    expect(auditarCopyDeTela("ansiedade percebida")).toEqual([]);
  });
});

describe("semAcento", () => {
  it("remove diacritico e preserva o resto", () => {
    expect(semAcento("Alteração de apetite")).toBe("Alteracao de apetite");
    expect(semAcento("Vida social")).toBe("Vida social");
  });

  it("todo item do lexico realmente tem acento", () => {
    // Um item sem acento na lista tornaria a regra incapaz de apontar correcao.
    for (const palavra of LEXICO_ACENTUADO) {
      expect(semAcento(palavra), palavra).not.toBe(palavra);
    }
  });
});
