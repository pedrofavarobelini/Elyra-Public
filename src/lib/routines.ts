

export const ROTINA = {
  RESPIRAR: "respirar",
  PAUSA: "pausa",
  DESACELERAR: "desacelerar",
  DORMIR: "dormir",
  FOCO: "foco",
  REFLEXAO: "reflexao",
  GRATIDAO: "gratidao",
} as const;

export type RotinaId = (typeof ROTINA)[keyof typeof ROTINA];

export interface PassoDaRotina {
  /** O que fazer agora. Instrucao, nunca promessa de efeito. */
  texto: string;
  /** Duracao do passo, em segundos. */
  segundos: number;
}

export interface Rotina {
  id: RotinaId;
  /** Nome como acao: "Respirar com calma", nao "Rotina para ansiedade". */
  nome: string;
  /** Uma linha sobre o que a rotina e — sem prometer resultado. */
  descricao: string;
  passos: PassoDaRotina[];
}

export const ROTINAS: readonly Rotina[] = [
  {
    id: ROTINA.RESPIRAR,
    nome: "Respirar com calma",
    descricao: "Um ciclo curto de respiração, no seu ritmo.",
    passos: [
      { texto: "Acomode-se como estiver confortável e solte os ombros.", segundos: 20 },
      { texto: "Inspire pelo nariz, contando até quatro.", segundos: 20 },
      { texto: "Segure o ar por um instante, sem forçar.", segundos: 15 },
      { texto: "Solte o ar devagar pela boca, contando até seis.", segundos: 25 },
      { texto: "Repita no seu ritmo, sem pressa.", segundos: 40 },
    ],
  },
  {
    id: ROTINA.PAUSA,
    nome: "Fazer uma pausa",
    descricao: "Dois minutos longe da tela, sem tarefa nenhuma.",
    passos: [
      { texto: "Afaste a atenção da tela e olhe para algo distante.", segundos: 30 },
      { texto: "Estique os braços e o pescoço devagar.", segundos: 30 },
      { texto: "Beba um pouco de água, se tiver por perto.", segundos: 20 },
      { texto: "Fique parado um momento antes de voltar.", segundos: 40 },
    ],
  },
  {
    id: ROTINA.DESACELERAR,
    nome: "Desacelerar",
    descricao: "Um caminho curto para diminuir o ritmo do corpo.",
    passos: [
      { texto: "Sente-se e apoie os pés inteiros no chão.", segundos: 20 },
      { texto: "Repare em três coisas que você consegue ver.", segundos: 30 },
      { texto: "Repare em dois sons que você consegue ouvir.", segundos: 30 },
      { texto: "Repare em uma coisa que você consegue tocar.", segundos: 30 },
      { texto: "Respire fundo uma vez antes de seguir.", segundos: 20 },
    ],
  },
  {
    id: ROTINA.DORMIR,
    nome: "Preparar para dormir",
    descricao: "Um encerramento tranquilo para o fim do dia.",
    passos: [
      { texto: "Diminua as luzes do ambiente, se puder.", segundos: 20 },
      { texto: "Deixe o celular longe de onde você vai deitar.", segundos: 20 },
      { texto: "Solte o corpo no colchão, uma parte de cada vez.", segundos: 45 },
      { texto: "Deixe a respiração ficar mais lenta, sem controlar.", segundos: 45 },
    ],
  },
  {
    id: ROTINA.FOCO,
    nome: "Entrar em foco",
    descricao: "Preparar o ambiente antes de começar algo.",
    passos: [
      { texto: "Escolha uma única coisa para fazer agora.", segundos: 25 },
      { texto: "Tire da mesa o que não for dessa tarefa.", segundos: 30 },
      { texto: "Silencie as notificações pelos próximos minutos.", segundos: 20 },
      { texto: "Comece pela parte mais simples dela.", segundos: 25 },
    ],
  },
  {
    id: ROTINA.REFLEXAO,
    nome: "Refletir sobre o dia",
    descricao: "Três perguntas curtas para olhar o dia que passou.",
    passos: [
      { texto: "O que ocupou mais espaço no seu dia hoje?", segundos: 40 },
      { texto: "Teve algum momento em que você se sentiu bem?", segundos: 40 },
      { texto: "Tem algo que você quer deixar registrado?", segundos: 40 },
    ],
  },
  {
    id: ROTINA.GRATIDAO,
    nome: "Reparar no que foi bom",
    descricao: "Um momento para notar o que passou despercebido.",
    passos: [
      { texto: "Pense em algo pequeno que funcionou hoje.", segundos: 40 },
      { texto: "Pense em alguém que tornou o dia mais leve.", segundos: 40 },
      { texto: "Se quiser, guarde isso numa anotação depois.", segundos: 30 },
    ],
  },
];

export function rotinaPorId(id: string): Rotina | null {
  return ROTINAS.find((r) => r.id === id) ?? null;
}

/** Duracao total, em segundos. */
export function duracaoTotal(rotina: Rotina): number {
  return rotina.passos.reduce((total, passo) => total + passo.segundos, 0);
}

/** "2 min" / "1 min 30 s" — para a tela dizer o custo antes de comecar. */
export function duracaoEmTexto(rotina: Rotina): string {
  const total = duracaoTotal(rotina);
  const minutos = Math.floor(total / 60);
  const segundos = total % 60;
  if (minutos === 0) return `${segundos} s`;
  if (segundos === 0) return `${minutos} min`;
  return `${minutos} min ${segundos} s`;
}

export interface PosicaoNaRotina {
  /** Indice do passo atual; `passos.length` quando terminou. */
  indice: number;
  /** Segundos restantes do passo atual. `0` quando terminou. */
  restante: number;
  terminou: boolean;
}

/**
 * Onde a rotina esta, dados os segundos decorridos.
 *
 * Funcao pura: o componente so conta o tempo, e **esta** funcao decide o passo.
 * Assim a regra de avanco tem teste proprio, incluindo as bordas que sempre
 * escapam — o instante exato da virada e o tempo alem do fim.
 */
export function posicaoEm(rotina: Rotina, decorridos: number): PosicaoNaRotina {
  const total = duracaoTotal(rotina);
  if (decorridos >= total) {
    return { indice: rotina.passos.length, restante: 0, terminou: true };
  }
  let acumulado = 0;
  for (let i = 0; i < rotina.passos.length; i += 1) {
    const passo = rotina.passos[i]!;
    if (decorridos < acumulado + passo.segundos) {
      return {
        indice: i,
        restante: acumulado + passo.segundos - decorridos,
        terminou: false,
      };
    }
    acumulado += passo.segundos;
  }
  // Inalcancavel: `decorridos < total` garante um passo acima.
  return { indice: rotina.passos.length, restante: 0, terminou: true };
}

/** Termos que nenhuma copy de rotina pode conter — verificado por teste. */
export const ROTINA_TERMOS_PROIBIDOS = [
  "trata",
  "tratamento",
  "cura",
  "sintoma",
  "terapia",
  "terapêutic",
  "ansiedade",
  "depress",
  "diagnóstic",
  "receita",
  "prescri",
  "reduz o estresse",
  "elimina",
  "garante",
] as const;
