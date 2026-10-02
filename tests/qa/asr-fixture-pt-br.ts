

export interface AsrFixtureBlock {
  id: string;
  /** O que este bloco existe para expor. */
  purpose: string;
  /** Instrucao de leitura. Faz parte do protocolo, nao da referencia. */
  direction: string;
  /** A referencia contra a qual o candidato sera comparado. */
  reference: string;
}

export const ASR_FIXTURE_ID = "elyra-asr-fixture-pt-br/v1";

export const ASR_FIXTURE_BLOCKS: readonly AsrFixtureBlock[] = [
  {
    id: "negacao",
    purpose: "Negação — um erro de uma palavra que inverte a frase.",
    direction: "Leia em ritmo normal, sem enfatizar as negações.",
    reference:
      "Hoje eu não consegui terminar a lista de compras. Não faltou tempo, faltou vontade. " +
      "Eu não disse que ia desistir e também não disse que ia continuar.",
  },
  {
    id: "numeros",
    purpose: "Números — dígito trocado, e alternância entre dígito e extenso.",
    direction: "Leia os números como estão escritos, sem corrigir.",
    reference:
      "Comprei 3 cadernos, 12 canetas e 25 envelopes. O ônibus das 7 horas atrasou 18 minutos. " +
      "O código do armário é 4071 e a sala fica no segundo andar.",
  },
  {
    id: "curtas",
    purpose: "Frases curtas — pouco contexto para o VAD e para o modelo.",
    direction: "Leia cada frase separadamente, com um respiro entre elas.",
    reference:
      "Está tudo certo. Depois eu volto. Não é hoje. Amanhã cedo. Pode deixar aí. Já resolvi isso.",
  },
  {
    id: "longa",
    purpose: "Fala contínua — onde o modelo pode derivar e completar sozinho.",
    direction: "Leia sem parar, em ritmo natural, do começo ao fim.",
    reference:
      "Ontem de manhã eu saí de casa mais cedo porque queria passar na papelaria antes do trabalho, " +
      "e no caminho lembrei que precisava devolver dois livros na biblioteca, então mudei o trajeto " +
      "e acabei atravessando o parque, que estava bem mais cheio do que eu esperava para um dia de " +
      "semana, com gente correndo, gente passeando com cachorro e um grupo grande sentado perto do " +
      "lago conversando alto sobre uma viagem que eles estavam planejando para o fim do ano.",
  },
  {
    id: "pausa",
    purpose: "Pausa longa — o corte do VAD entre dois segmentos.",
    direction:
      "Leia a primeira frase, fique em silêncio contando até cinco, e só então leia a segunda.",
    reference:
      "Vou verificar o horário do treino. O treino é na quinta-feira à noite.",
  },
  {
    id: "retomada",
    purpose:
      "Retomada — recomeço de fala depois da pausa, onde a costura pode inventar texto.",
    direction:
      "Comece a frase, pare no meio por três segundos, e retome exatamente de onde parou.",
    reference:
      "Eu ia dizer que a reunião mudou de sala, mas na verdade mudou de dia também.",
  },
] as const;

/** A referencia completa, na ordem de leitura. */
export function fixtureReference(): string {
  return ASR_FIXTURE_BLOCKS.map((block) => block.reference).join(" ");
}
