

export const INSTANCE_TOPOLOGY = {
  /** Um processo servindo a aplicacao. Limitador em memoria e autoritativo. */
  SINGLE: "single",
  /** Varios processos/regioes. Exige limitador compartilhado (ADR proprio). */
  MULTI: "multi",
} as const;
export type InstanceTopology = (typeof INSTANCE_TOPOLOGY)[keyof typeof INSTANCE_TOPOLOGY];

/** Variavel que declara a topologia. Ausente = `single` (o padrao declarado). */
export const TOPOLOGY_VAR = "ELYRA_INSTANCE_TOPOLOGY" as const;

/** Ambientes em que uma topologia mal declarada nao pode ser tolerada. */
const STRICT_ENVS = new Set(["staging", "production"]);

export type TopologyEnvironment = Readonly<Record<string, string | undefined>>;

export class InstanceTopologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstanceTopologyError";
  }
}

/**
 * Topologia declarada, ou `null` quando o valor existe e nao e reconhecido.
 *
 * Valor desconhecido **nao** cai no padrao: "single" por engano de digitacao e
 * exatamente o silencio que este modulo existe para impedir.
 */
export function declaredTopology(
  env: TopologyEnvironment = process.env,
): InstanceTopology | null {
  const raw = env[TOPOLOGY_VAR]?.trim().toLowerCase();
  if (!raw) return INSTANCE_TOPOLOGY.SINGLE;
  if (raw === INSTANCE_TOPOLOGY.SINGLE || raw === INSTANCE_TOPOLOGY.MULTI) return raw;
  return null;
}

/**
 * Existe limitador compartilhado configurado?
 *
 * Hoje **nao existe** — nenhuma peca foi adicionada, porque nenhuma medicao a
 * justificou. A funcao existe para o dia em que existir: quem introduzir o
 * limitador compartilhado (com ADR e medicao) passa a declara-lo aqui, e o
 * guarda abaixo para de recusar a topologia multi.
 */
export function sharedRateLimitStoreConfigured(
  env: TopologyEnvironment = process.env,
): boolean {
  // Nenhuma chave de limitador compartilhado existe no contrato de ambiente
  // ainda; quando existir, e aqui que ela passa a ser lida.
  return Boolean(env.ELYRA_SHARED_RATE_LIMIT_URL);
}

/** O limitador em memoria conta o total real de requisicoes deste ambiente? */
export function rateLimitIsAuthoritative(
  env: TopologyEnvironment = process.env,
): boolean {
  if (sharedRateLimitStoreConfigured(env)) return true;
  return declaredTopology(env) === INSTANCE_TOPOLOGY.SINGLE;
}

/**
 * Recusa atender com topologia que o limitador nao sustenta.
 *
 * Chamada no boot (`src/instrumentation.ts`): falhar ali e visivel e reversivel —
 * o log traz `InstanceTopologyError` e toda requisicao responde 500. Descobrir
 * depois, num incidente, que o limite valia `limite x N` nao e nenhum dos dois. Em `development` e `qa` a mesma
 * inconsistencia vira erro tambem quando o valor e ilegivel, mas topologia
 * multi declarada e apenas recusada nos ambientes estritos — ninguem publica
 * producao a partir de `npm run dev`.
 */
export function assertRateLimitTopology(env: TopologyEnvironment = process.env): void {
  const topology = declaredTopology(env);
  if (topology === null) {
    throw new InstanceTopologyError(
      `${TOPOLOGY_VAR} tem valor nao reconhecido. Use "single" ou "multi" (ADR-0015).`,
    );
  }
  const runtime = env.ELYRA_RUNTIME_ENV?.trim().toLowerCase() ?? "";
  if (!STRICT_ENVS.has(runtime)) return;
  if (topology === INSTANCE_TOPOLOGY.MULTI && !sharedRateLimitStoreConfigured(env)) {
    throw new InstanceTopologyError(
      `Topologia "multi" em ${runtime} sem limitador de requisicoes compartilhado: ` +
        "o limite efetivo seria multiplicado pelo numero de instancias (L-040). " +
        "Resolva com ADR proprio antes de publicar (ADR-0015).",
    );
  }
}
