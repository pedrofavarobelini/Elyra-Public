import { describe, expect, it } from "vitest";

import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_LABEL,
  NOTIFICATION_COPY,
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_DESCRIPTION,
  NOTIFICATION_KIND_LABEL,
  NOTIFICATION_PRIORITY,
  SNOOZE_OPTIONS,
} from "@/lib/contracts/notifications";



/** Comparacao sem acento e sem caixa: "você não" e "voce nao" sao a mesma cobranca. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-BR");
}

/**
 * Cada padrao aqui e uma forma conhecida de transformar ausencia em divida.
 *
 * `dias sem` e o exemplo canonico: "5 dias sem registrar" mede a pessoa contra
 * uma frequencia que ninguem combinou. `ultimo aviso` e `nao perca` fabricam
 * escassez. `voce nao` abre quase toda frase de cobranca em portugues.
 */
const COBRANCA = [
  "voce nao",
  "voce ainda nao",
  "nao esqueca",
  "nao se esqueca",
  "dias sem",
  "ha dias",
  "faz tempo",
  "ultimo aviso",
  "ultima chance",
  "nao perca",
  "urgente",
  "imediatamente",
  "agora mesmo",
  "atrasad",
  "pendencia sua",
  "voce falhou",
  "que pena",
  "so hoje",
  "aproveite",
] as const;

const TEXTOS = [
  ...NOTIFICATION_KINDS.flatMap((kind) => [
    { origem: `NOTIFICATION_COPY.${kind}.title`, texto: NOTIFICATION_COPY[kind].title },
    { origem: `NOTIFICATION_COPY.${kind}.message`, texto: NOTIFICATION_COPY[kind].message },
    { origem: `NOTIFICATION_KIND_LABEL.${kind}`, texto: NOTIFICATION_KIND_LABEL[kind] },
    {
      origem: `NOTIFICATION_KIND_DESCRIPTION.${kind}`,
      texto: NOTIFICATION_KIND_DESCRIPTION[kind],
    },
  ]),
  ...NOTIFICATION_CHANNELS.map((channel) => ({
    origem: `NOTIFICATION_CHANNEL_LABEL.${channel}`,
    texto: NOTIFICATION_CHANNEL_LABEL[channel],
  })),
  ...SNOOZE_OPTIONS.map((option) => ({
    origem: `SNOOZE_OPTIONS.${option.id}`,
    texto: option.label,
  })),
];

describe("Era 5 - copy de notificacao nao cobra", () => {
  it("nenhum texto exibido usa culpa ou urgencia artificial", () => {
    const encontrados = TEXTOS.flatMap(({ origem, texto }) => {
      const normalizado = normalizar(texto);
      return COBRANCA.filter((padrao) => normalizado.includes(padrao)).map(
        (padrao) => `${origem}: "${padrao}"`,
      );
    });
    expect(encontrados).toEqual([]);
  });

  it("nenhum texto exibido usa ponto de exclamacao", () => {
    /*
      Exclamacao nao e proibida por estilo: num aviso que chega sem ser pedido,
      ela e a entonacao que transforma informacao em insistencia. O produto
      inteiro fala em tom baixo, e a notificacao e onde isso mais importa.
    */
    const gritando = TEXTOS.filter(({ texto }) => texto.includes("!"));
    expect(gritando.map((item) => item.origem)).toEqual([]);
  });

  it("todo tipo tem copy, rotulo e descricao proprios", () => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(NOTIFICATION_COPY[kind].title.trim().length).toBeGreaterThan(0);
      expect(NOTIFICATION_COPY[kind].message.trim().length).toBeGreaterThan(0);
      expect(NOTIFICATION_KIND_LABEL[kind].trim().length).toBeGreaterThan(0);
      expect(NOTIFICATION_KIND_DESCRIPTION[kind].trim().length).toBeGreaterThan(0);
    }
  });

  it("a copy cabe no contrato persistido", () => {
    // Os mesmos tetos do `notificationSchema`: uma copy maior que o contrato
    // quebraria a validacao na leitura, e nao na escrita — longe da causa.
    for (const kind of NOTIFICATION_KINDS) {
      expect(NOTIFICATION_COPY[kind].title.length).toBeLessThanOrEqual(80);
      expect(NOTIFICATION_COPY[kind].message.length).toBeLessThanOrEqual(180);
    }
  });

  it("so o aviso de servico pode interromper", () => {

    const importantes = NOTIFICATION_KINDS.filter(
      (kind) => NOTIFICATION_PRIORITY[kind] === "important",
    );
    expect(importantes).toEqual(["system_notice"]);
  });

  it("adiar tem prazo, e o maior prazo nao e disfarce de desligar", () => {
    expect(SNOOZE_OPTIONS.length).toBeGreaterThan(0);
    for (const option of SNOOZE_OPTIONS) {
      expect(option.days).toBeGreaterThan(0);
      // Uma semana e o teto: alem disso, o controle honesto e desligar.
      expect(option.days).toBeLessThanOrEqual(7);
    }
  });
});


describe("Era 7 - notificacao nao carrega conteudo emocional", () => {
  const textos = Object.values(NOTIFICATION_COPY).flatMap((copy) => [
    copy.title,
    copy.message,
  ]);

  it("nenhuma copy interpola dado: sao templates fixos", () => {
    for (const texto of textos) {
      expect(texto).not.toMatch(/\{\{|\}\}|\$\{|%s|:\s*\w+\b\s*$/);
    }
  });

  it("nenhuma copy cita sentimento, humor, diario ou ciclo", () => {
    const proibido =
      /\b(triste|feliz|ansios[ao]|irritad[ao]|cansad[ao]|deprimid[ao]|humor|sentimento|diario|diário|anotac|anotaç|ciclo|menstrua|sono de|nota\s+\d)\b/i;
    for (const texto of textos) {
      expect(texto, `copy vazou conteudo: "${texto}"`).not.toMatch(proibido);
    }
  });

  it("nenhuma copy carrega numero de escala (1 a 5) como se fosse dado da pessoa", () => {
    for (const texto of textos) {
      expect(texto).not.toMatch(/\b[1-5]\s*\/\s*5\b|\bnota\s*[1-5]\b/i);
    }
  });

  it("o convite e generico: chama para a Elyra, sem dizer o que ha lá dentro", () => {
    // "registrar como voce esta se sentindo" e convite; "voce marcou ansioso" seria conteudo.
    for (const { message } of Object.values(NOTIFICATION_COPY)) {
      expect(message).not.toMatch(/\bvoce (marcou|registrou|escreveu)\b/i);
    }
  });
});
