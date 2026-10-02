import "server-only";

/**
 * Runtime dos providers externos: timeout curto, circuit breaker, cache curto,
 * guarda de custo e observabilidade sem PII.
 *
 * Tudo em memoria de processo — a mesma premissa do rate limit da V1 (monolito
 * de instancia unica). **Limitacao real:** com mais de uma instancia, cada uma
 * tem seu proprio contador e disjuntor; o orcamento pago precisa migrar para o
 * banco antes de escalar horizontalmente com provider pago ligado.
 */

export class ProviderTimeoutError extends Error {
  constructor() {
    super("provider_timeout");
    this.name = "ProviderTimeoutError";
  }
}

export async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ProviderTimeoutError());
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Abre apos `threshold` falhas seguidas; fica aberto `coolDownMs`. */
export class CircuitBreaker {
  private failures = new Map<string, number>();
  private openUntil = new Map<string, number>();

  constructor(
    private readonly threshold = 3,
    private readonly coolDownMs = 60_000,
    private readonly clock: () => number = Date.now,
  ) {}

  isOpen(key: string): boolean {
    const until = this.openUntil.get(key) ?? 0;
    if (until > this.clock()) return true;
    if (until) {
      this.openUntil.delete(key);
      this.failures.set(key, this.threshold - 1); // meia-abertura: uma tentativa
    }
    return false;
  }

  success(key: string) {
    this.failures.delete(key);
    this.openUntil.delete(key);
  }

  failure(key: string) {
    const count = (this.failures.get(key) ?? 0) + 1;
    this.failures.set(key, count);
    if (count >= this.threshold) this.openUntil.set(key, this.clock() + this.coolDownMs);
  }
}

/**
 * Cache curto por consulta. Nao e afirmacao de frescor do registro (a decisao
 * exige evidencia de ate 24 h e a reverificacao e periodica): serve para que
 * dois envios seguidos nao consultem a fonte duas vezes.
 */
export class TtlCache<T> {
  private entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly clock: () => number = Date.now,
    private readonly maxEntries = 500,
  ) {}

  get(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.clock()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T) {
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: this.clock() + this.ttlMs });
  }
}

/**
 * Guarda de custo. Todo provider `billing = "paid"` passa por aqui ANTES de
 * qualquer request. Limite 0 = zero chamadas. Cada chamada consumida vira log.
 */
export class CostGuard {
  private day = "";
  private used = 0;

  constructor(
    private readonly dailyLimit: number,
    private readonly clock: () => number = Date.now,
  ) {}

  tryConsume(provider: string): boolean {
    const today = new Date(this.clock()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
    if (this.dailyLimit <= 0 || this.used >= this.dailyLimit) return false;
    this.used += 1;
    observe({ provider, operation: "paid_call_reserved", result: "reserved", latencyMs: 0 });
    return true;
  }

  get consumed() {
    return this.used;
  }
}

export interface ProviderObservation {
  provider: string;
  operation: string;
  result: string;
  latencyMs: number;
  errorCategory?: string;
}

/**
 * Uma linha por chamada. So codigos e numeros: nunca nome, CPF, RG, numero de
 * registro, resposta bruta, token ou chave.
 */
export function observe(event: ProviderObservation) {
  const safe = (value: string) => value.replace(/[^a-z0-9_:.-]/gi, "").slice(0, 48);
  console.info(
    `elyra.verification_provider provider=${safe(event.provider)} operation=${safe(event.operation)} ` +
      `result=${safe(event.result)} latency_ms=${Math.max(0, Math.round(event.latencyMs))}` +
      (event.errorCategory ? ` error=${safe(event.errorCategory)}` : "") +
      ` at=${new Date().toISOString()}`,
  );
}
