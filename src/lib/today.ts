import type { CycleDailyRecord, CycleProfile } from "@/lib/contracts/cycle";
import type { EmotionalCheckin } from "@/lib/contracts/emotional";
import type { Goal, GoalProgressEntry } from "@/lib/contracts/goals";
import { progressInPeriod } from "@/lib/contracts/goals";
import type { JournalEntry } from "@/lib/contracts/journal";



export const FATO_HOJE = {
  CHECKIN: "checkin",
  METAS: "metas",
  DIARIO: "diario",
  CICLO: "ciclo",
  SINCRONIZACAO: "sincronizacao",
} as const;

export type TipoFatoHoje = (typeof FATO_HOJE)[keyof typeof FATO_HOJE];

/**
 * Tom do item — apresentacao, nao julgamento.
 *
 * `convite` abre um caminho; `registro` confirma o que ja foi feito; `aviso`
 * existe so para o que **depende de acao tecnica** (fila por sincronizar).
 * Nao ha tom negativo, de proposito: nenhum fato desta tela e uma repreensao.
 */
export type TomFato = "convite" | "registro" | "aviso";

export interface FatoDeHoje {
  /** Estavel entre renders: serve de `key` e de ancora no teste. */
  id: TipoFatoHoje;
  tipo: TipoFatoHoje;
  titulo: string;
  detalhe?: string;
  tom: TomFato;
  /** Caminho para uma tela **que ja existe**. Nunca URL externa. */
  acao?: { label: string; href: string };
}

export interface EstadoDeHoje {
  checkins: readonly EmotionalCheckin[];
  goals: readonly Goal[];
  goalProgress: readonly GoalProgressEntry[];
  journal: readonly JournalEntry[];
  cycle: Pick<CycleProfile, "enabled">;
  cycleRecords: readonly CycleDailyRecord[];

  pendentes: number;
}

/** Data civil local (YYYY-MM-DD) — o dia que a pessoa enxerga no relogio dela. */
export function diaCivil(momento: Date): string {
  const ano = momento.getFullYear();
  const mes = String(momento.getMonth() + 1).padStart(2, "0");
  const dia = String(momento.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

/** O instante pertence ao dia civil local informado? */
function ehDoDia(iso: string, dia: string): boolean {
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? false : diaCivil(data) === dia;
}

function fatoCheckin(
  checkins: readonly EmotionalCheckin[],
  hoje: string,
): FatoDeHoje {
  const doDia = checkins.filter((c) => ehDoDia(c.occurredAt, hoje));
  if (doDia.length === 0) {
    return {
      id: FATO_HOJE.CHECKIN,
      tipo: FATO_HOJE.CHECKIN,
      titulo: "Você ainda não registrou como está hoje",
      detalhe: "Leva alguns segundos, e você pode detalhar depois.",
      tom: "convite",
      acao: { label: "Fazer check-in", href: "/meu-humor" },
    };
  }
  return {
    id: FATO_HOJE.CHECKIN,
    tipo: FATO_HOJE.CHECKIN,
    titulo:
      doDia.length === 1
        ? "Você registrou como está hoje"
        : `Você fez ${doDia.length} registros hoje`,
    // Nada do conteudo do check-in aparece aqui: o Dashboard ja mostra o que cabe.
    tom: "registro",
    acao: { label: "Ver Meu Humor", href: "/meu-humor" },
  };
}

function fatoMetas(
  goals: readonly Goal[],
  progresso: readonly GoalProgressEntry[],
  agora: Date,
): FatoDeHoje | null {
  const ativas = goals.filter((g) => g.status === "active");
  if (ativas.length === 0) return null;


  const lista = [...progresso];
  const comProgresso = ativas.filter(
    (g) => progressInPeriod(lista, g, agora) > 0,
  );
  const restantes = ativas.length - comProgresso.length;

  if (restantes === 0) {
    return {
      id: FATO_HOJE.METAS,
      tipo: FATO_HOJE.METAS,
      titulo:
        ativas.length === 1
          ? "Sua meta já teve progresso neste período"
          : "Todas as suas metas já tiveram progresso neste período",
      tom: "registro",
      acao: { label: "Ver metas", href: "/metas" },
    };
  }

  return {
    id: FATO_HOJE.METAS,
    tipo: FATO_HOJE.METAS,
    // Contagem do que **existe**, e nao do que "faltou": a meta esta aberta, nao atrasada.
    titulo:
      restantes === 1
        ? "Você tem 1 meta aberta neste período"
        : `Você tem ${restantes} metas abertas neste período`,
    detalhe: "Registrar progresso é opcional e pode ser feito quando fizer sentido.",
    tom: "convite",
    acao: { label: "Acompanhar metas", href: "/metas" },
  };
}

function fatoDiario(
  journal: readonly JournalEntry[],
  hoje: string,
): FatoDeHoje | null {
  const doDia = journal.filter(
    (e) => e.status === "saved" && ehDoDia(e.updatedAt, hoje),
  );
  /*
    Sem anotacao hoje **nao** vira item. Escrever no diario nao e tarefa diaria,
    e cobrar isso todo dia seria transformar um espaco livre em obrigacao. O
    convite para escrever ja existe no proprio Dashboard.
  */
  if (doDia.length === 0) return null;
  return {
    id: FATO_HOJE.DIARIO,
    tipo: FATO_HOJE.DIARIO,
    titulo:
      doDia.length === 1
        ? "Você escreveu no Diário hoje"
        : `Você escreveu ${doDia.length} vezes no Diário hoje`,
    // Nenhum trecho do texto aparece: o conteudo fica na tela dele.
    tom: "registro",
    acao: { label: "Abrir o Diário", href: "/diario" },
  };
}

function fatoCiclo(
  cycle: Pick<CycleProfile, "enabled">,
  registros: readonly CycleDailyRecord[],
  hoje: string,
): FatoDeHoje | null {
  // Modulo desligado nao aparece, nem como convite: quem desligou ja escolheu.
  if (!cycle.enabled) return null;
  const doDia = registros.some((r) => r.date === hoje);
  if (doDia) {
    return {
      id: FATO_HOJE.CICLO,
      tipo: FATO_HOJE.CICLO,
      titulo: "Você registrou o ciclo hoje",
      tom: "registro",
      acao: { label: "Ver Ciclo", href: "/ciclo" },
    };
  }
  return {
    id: FATO_HOJE.CICLO,
    tipo: FATO_HOJE.CICLO,
    titulo: "Nenhum registro de ciclo hoje",
    detalhe: "Só entra o que você observar. Nada é estimado.",
    tom: "convite",
    acao: { label: "Abrir Ciclo", href: "/ciclo" },
  };
}

function fatoSincronizacao(pendentes: number): FatoDeHoje | null {
  if (pendentes <= 0) return null;
  return {
    id: FATO_HOJE.SINCRONIZACAO,
    tipo: FATO_HOJE.SINCRONIZACAO,
    titulo:
      pendentes === 1
        ? "1 alteração ainda está só neste aparelho"
        : `${pendentes} alterações ainda estão só neste aparelho`,
    detalhe: "Elas são enviadas sozinhas quando a conexão voltar.",
    tom: "aviso",
  };
}

/**
 * Os fatos de hoje, em ordem fixa.
 *
 * Ordem estavel de proposito: uma tela que se reorganiza a cada visita obriga a
 * pessoa a reprocurar o que ja conhecia. Itens que nao se aplicam somem — mas os
 * que ficam nunca trocam de lugar entre si.
 */
export function derivarHoje(
  estado: EstadoDeHoje,
  agora: Date = new Date(),
): FatoDeHoje[] {
  const hoje = diaCivil(agora);
  return [
    fatoCheckin(estado.checkins, hoje),
    fatoMetas(estado.goals, estado.goalProgress, agora),
    fatoDiario(estado.journal, hoje),
    fatoCiclo(estado.cycle, estado.cycleRecords, hoje),
    fatoSincronizacao(estado.pendentes),
  ].filter((fato): fato is FatoDeHoje => fato !== null);
}
