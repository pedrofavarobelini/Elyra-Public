

export const MUTATION_TRACE_HEADER = "x-elyra-trace-id";
export const MUTATION_TRACE_MARKER = "ELYRA_MUTATION_TRACE ";

const TRACE_ID = /^[a-z0-9-]{1,64}$/;

export type MutationTraceMarker =
  | "PROXY_RECEIVED"
  | "PROXY_RETURNING"
  | "HANDLER_RECEIVED"
  | "SERVICE_FINISHED"
  | "RESPONSE_CREATED"
  | "HANDLER_RETURNING";

export interface MutationTraceEvent {
  id: string;
  marker: MutationTraceMarker;
  method: string;
  route: string;
  /** Relogio monotonico do processo, em milissegundos. */
  t: number;
}

/** `qa` e a unica origem possivel de emissao. Ver o bloco acima. */
function qaRuntime(): boolean {
  return process.env.ELYRA_RUNTIME_ENV === "qa";
}

export function readTraceId(headers: Headers): string | null {
  const raw = headers.get(MUTATION_TRACE_HEADER);
  if (!raw) return null;
  const candidate = raw.trim().toLowerCase();
  return TRACE_ID.test(candidate) ? candidate : null;
}

export function formatMutationTrace(event: MutationTraceEvent): string {
  return MUTATION_TRACE_MARKER + JSON.stringify(event);
}

export function parseMutationTrace(line: string): MutationTraceEvent | null {
  const at = line.indexOf(MUTATION_TRACE_MARKER);
  if (at < 0) return null;
  try {
    const parsed = JSON.parse(
      line.slice(at + MUTATION_TRACE_MARKER.length).trim(),
    ) as Partial<MutationTraceEvent>;
    if (typeof parsed.id !== "string" || typeof parsed.marker !== "string") {
      return null;
    }
    if (typeof parsed.t !== "number") return null;
    return parsed as MutationTraceEvent;
  } catch {
    return null;
  }
}

/**
 * Emite um marcador, se e somente se as duas condicoes valerem.
 *
 * Devolve a correlacao para que o chamador possa encadear os marcadores
 * seguintes sem reler o header - e `null` quando nao ha nada a rastrear, que e
 * o caso de toda request de producao.
 */
export function traceMutation(
  marker: MutationTraceMarker,
  request: { method: string; headers: Headers },
  route: string,
  traceId?: string | null,
): string | null {
  if (!qaRuntime()) return null;
  const id = traceId ?? readTraceId(request.headers);
  if (!id) return null;
  console.error(
    formatMutationTrace({
      id,
      marker,
      method: request.method,
      route,
      t: performance.now(),
    }),
  );
  return id;
}
