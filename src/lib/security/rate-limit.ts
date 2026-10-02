

export interface RateLimitRule {
  /** Requisicoes permitidas na janela. */
  limit: number;
  /** Tamanho da janela em milissegundos. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Segundos ate a janela reabrir. Vira `Retry-After` na resposta. */
  retryAfterSeconds: number;
}

interface Counter {
  count: number;
  resetAt: number;
}

/**
 * Limites por familia de endpoint.
 *
 * Numeros escolhidos para nao atrapalhar uso humano legitimo e ainda assim
 * cortar repeticao automatizada. Exportacao e exclusao sao propositalmente
 * baixos: sao operacoes raras e caras, e ninguem exporta os proprios dados
 * dezenas de vezes por minuto.
 */
export const RATE_LIMIT_RULES = {
  auth: { limit: 10, windowMs: 60_000 },

  passwordRecovery: { limit: 5, windowMs: 300_000 },

  passwordReset: { limit: 5, windowMs: 300_000 },

  passwordRecoveryRecipient: { limit: 3, windowMs: 3_600_000 },
  /**
   * Disparo do dispatcher de e-mail (`/api/internal/notifications/dispatch`).
   * O agendador chama a cada poucos minutos; doze por minuto ja e abuso ou
   * laco, e cada disparo custa leitura de muitos titulares.
   */
  notificationDispatch: { limit: 12, windowMs: 60_000 },
  /**
   * Aceite dos termos no primeiro acesso.
   *
   * Uma pessoa aceita uma vez na vida da conta; o resto sao retentativas depois
   * de erro. Um teto modesto contem repeticao automatizada contra a acao que
   * grava consentimento sem atrapalhar ninguem.
   */
  consentAccept: { limit: 10, windowMs: 300_000 },
  /**
   * Mutacao da matriz de notificacao.
   *
   * Generoso de proposito: alternar interruptores e uso normal, e quem esta
   * ajustando doze pares faz doze chamadas em segundos. O que este teto corta e
   * repeticao automatizada, e nao a pessoa decidindo como quer ser avisada. O
   * `GET` da mesma rota **nao** e limitado — seria teto em leitura estavel e
   * barata, so para marcar caixa.
   */
  notificationPreference: { limit: 60, windowMs: 60_000 },
  /**
   * Retorno do OAuth.
   *
   * `/auth/callback` e endereco **publico**: qualquer um monta um link para ele,
   * e cada chamada com `code` invalido custa uma ida ao provedor de identidade.
   * Chave por IP, porque aqui ainda nao ha sessao.
   */
  oauthCallback: { limit: 20, windowMs: 300_000 },
  pedrocore: { limit: 20, windowMs: 60_000 },
  learning: { limit: 10, windowMs: 60_000 },
  signedUrl: { limit: 60, windowMs: 60_000 },
  upload: { limit: 30, windowMs: 60_000 },
  subjectExport: { limit: 3, windowMs: 300_000 },
  accountDeletion: { limit: 5, windowMs: 300_000 },
  professionalInvite: { limit: 20, windowMs: 60_000 },

  professionalReview: { limit: 30, windowMs: 60_000 },

  professionalInviteRedeem: { limit: 10, windowMs: 300_000 },

  professionalDirectory: { limit: 40, windowMs: 60_000 },

  schedulingWrite: { limit: 20, windowMs: 60_000 },

  helpRequestWrite: { limit: 20, windowMs: 60_000 },
  /**
   * Leitura de horarios livres. Trocar de profissional ou de semana gera
   * algumas leituras; sessenta por minuto ja e varredura de agenda alheia.
   */
  schedulingRead: { limit: 60, windowMs: 60_000 },
  /**
   * SUP-2: busca na Rede de Apoio (municipio + tipo + pagina). Trocar de
   * municipio, de filtro e paginar da algumas leituras; sessenta por minuto ja
   * e raspagem do snapshot, que e publico mas nao e para ser espelhado daqui.
   */
  supportNetworkRead: { limit: 60, windowMs: 60_000 },
  /**
   * Sessao profissional (PRO-7): entrar, sair, encerrar, mudar consentimento,
   * ler transcricao. O banco tem o proprio teto de emissao de credencial
   * (6 por 10 min por participante); este balde corta repeticao antes.
   */
  sessionAccess: { limit: 30, windowMs: 60_000 },
  /**
   * PRO-7R: autorizacao de midia. Uma chamada normal faz 1 `join` + 1
   * heartbeat a cada 30 s + poucos eventos; 20/min cobre reconexoes seguidas
   * sem deixar um script martelar o provider.
   */
  sessionMedia: { limit: 20, windowMs: 60_000 },
  /**
   * Pedido de acompanhamento pela descoberta (fluxo B). Poucos por dia numa
   * jornada real; o banco tem o proprio teto (5/24 h por pessoa, 3/30 dias por
   * profissional, 7 dias depois de recusa). Este balde corta rajada antes.
   */
  connectionRequest: { limit: 5, windowMs: 600_000 },
  /**
   * F2: envio do cadastro profissional para verificacao. Um envio e raro
   * (primeiro cadastro, uma correcao); cada um gera trilha e aviso. 5 por
   * 10 minutos cobre quem reenvia apos corrigir sem permitir spam de fila.
   */
  professionalOnboardingSubmit: { limit: 5, windowMs: 600_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitScope = keyof typeof RATE_LIMIT_RULES;


export const QA_RUNTIME_ENV = "qa" as const;

/**
 * Teto do fator de escala.
 *
 * Nao e o tamanho maximo de um grupo: e o ponto em que "homologacao coletiva"
 * deixa de ser uma explicacao plausivel. Um valor absurdo em variavel de
 * ambiente - por engano ou nao - passa a valer o limite de producao em vez de
 * abrir o balde indefinidamente.
 */
const MAX_QA_GROUP_SIZE = 40;

export type RateLimitEnvironment = Readonly<Record<string, string | undefined>>;

export function effectiveRateLimitRule(
  scope: RateLimitScope,
  env: RateLimitEnvironment = process.env,
): RateLimitRule {
  const base = RATE_LIMIT_RULES[scope];
  // Somente o balde pre-autenticacao sofre com NAT. Exportacao, exclusao,
  // upload e os demais escopos ja chaveiam por `user:<id>` e nao tem esse
  // problema - escala-los seria afrouxar sem motivo.
  if (scope !== "auth") return base;
  if (env.ELYRA_RUNTIME_ENV !== QA_RUNTIME_ENV) return base;

  const declared = Number(env.ELYRA_QA_GROUP_SIZE);
  if (!Number.isInteger(declared) || declared < 2 || declared > MAX_QA_GROUP_SIZE) {
    return base;
  }
  return { limit: base.limit * declared, windowMs: base.windowMs };
}

const MAX_TRACKED_KEYS = 10_000;

const counters = new Map<string, Counter>();

/**
 * Remove janelas ja expiradas.
 *
 * Sem isso o mapa cresceria com uma entrada por identidade vista, para sempre —
 * um rate limiter que vira vazamento de memoria protege menos do que atrapalha.
 */
function evictExpired(now: number): void {
  for (const [key, counter] of counters) {
    if (counter.resetAt <= now) counters.delete(key);
  }
}

export function consumeRateLimit(
  scope: RateLimitScope,
  identity: string,
  now: number = Date.now(),
): RateLimitResult {
  // A regra vigente, nao a de producao: em QA declarado o balde `auth` pode
  // estar escalado para o tamanho do grupo. Ver `effectiveRateLimitRule`.
  const rule = effectiveRateLimitRule(scope);
  const key = `${scope}:${identity}`;

  const existing = counters.get(key);
  if (!existing || existing.resetAt <= now) {
    if (counters.size >= MAX_TRACKED_KEYS) evictExpired(now);
    counters.set(key, { count: 1, resetAt: now + rule.windowMs });
    return {
      allowed: true,
      remaining: rule.limit - 1,
      retryAfterSeconds: 0,
    };
  }

  if (existing.count >= rule.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: rule.limit - existing.count,
    retryAfterSeconds: 0,
  };
}

/** Usado apenas por teste; nunca chamado em runtime. */
export function resetRateLimits(): void {
  counters.clear();
}

/**
 * Identidade usada como chave.
 *
 * Preferir o id autenticado: um IP e compartilhado por NAT e um limite por IP
 * puniria uma rede inteira pelo abuso de um. Sem sessao, cai para o IP
 * encaminhado — e, sem nenhum dos dois, para uma chave fixa, que e o caso
 * fail-closed: todos os anonimos sem IP compartilham o mesmo balde.
 */
export function rateLimitIdentity(
  userId: string | null,
  forwardedFor: string | null,
  env: RateLimitEnvironment = process.env,
): string {
  if (userId) return `user:${userId}`;
  const ip = trustedClientIp(forwardedFor, trustedProxyHops(env));
  return ip ? `ip:${ip}` : "anonymous";
}

const MAX_TRUSTED_PROXY_HOPS = 5;

/**
 * Quantos proxies confiaveis ficam entre a internet e o `next start`
 * (`ELYRA_TRUSTED_PROXY_HOPS`, padrao 1: a borda TLS do host).
 *
 * Valor ilegivel ou fora de 1..5 volta ao padrao em vez de desligar a regra.
 */
export function trustedProxyHops(env: RateLimitEnvironment = process.env): number {
  const declared = Number(env.ELYRA_TRUSTED_PROXY_HOPS);
  return Number.isInteger(declared) && declared >= 1 && declared <= MAX_TRUSTED_PROXY_HOPS ? declared : 1;
}

/**
 * IP do cliente a partir do `X-Forwarded-For`, contado **da direita**.
 *
 * Cada proxy ACRESCENTA quem o chamou ao fim da lista; o comeco e o que o
 * cliente mandou, e o cliente manda o que quiser. Ler o primeiro item deixava
 * qualquer um trocar de balde a cada requisicao so trocando o header (L-427).
 * Sem proxy, o proprio Next preenche o header com o IP do socket (um item).
 *
 * Lista menor que o numero de saltos: todos os itens vieram de proxies, e o
 * mais antigo e o mais proximo do cliente.
 */
export function trustedClientIp(forwardedFor: string | null, hops: number): string | null {
  const entries = (forwardedFor ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) return null;
  const candidate = entries[Math.max(0, entries.length - hops)] ?? "";
  // Chave curta e sem caractere estranho: o header nao controla o formato do balde.
  return /^[0-9A-Fa-f:.]{2,45}$/.test(candidate) ? candidate : null;
}

/** Resposta padrao de limite excedido, sem revelar contadores internos. */
export function rateLimitedResponse(result: RateLimitResult): Response {
  return Response.json(
    { error: "Muitas requisicoes. Tente novamente em instantes." },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    },
  );
}
