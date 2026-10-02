/**
 * Matriz offline canonica, por rota (OFF-1, L-409).
 *
 * Fonte unica para o shell offline e para os testes: a documentacao
 * (`Offline-Reconciliation-Mapping`) descreve esta tabela, e nao o contrario.
 *
 * Classes:
 * - `OFFLINE_FULL`: le e escreve local; sincroniza quando aplicavel;
 * - `READ_ONLY_OFFLINE`: le a ultima copia local; nao promete mutacao;
 * - `QUEUEABLE`: grava na outbox e envia depois (so operacao idempotente);
 * - `ONLINE_ONLY`: depende da conta online;
 * - `NO_OFFLINE_BY_DESIGN`: proibido sem rede (autorizacao, seguranca,
 *   consistencia) — uma fila aqui criaria estado falso.
 *
 * `shell` diz o que o `/offline` monta: a view local (`core`/`support`) ou o
 * estado "precisa de conexao" (`online_only`). A area profissional tem estado
 * proprio: sem rede, ela nunca vira o workspace pessoal.
 */

export const OFFLINE_CLASS = {
  OFFLINE_FULL: "OFFLINE_FULL",
  READ_ONLY_OFFLINE: "READ_ONLY_OFFLINE",
  QUEUEABLE: "QUEUEABLE",
  ONLINE_ONLY: "ONLINE_ONLY",
  NO_OFFLINE_BY_DESIGN: "NO_OFFLINE_BY_DESIGN",
} as const;
export type OfflineClass = (typeof OFFLINE_CLASS)[keyof typeof OFFLINE_CLASS];

export type OfflineShellMode = "core" | "support" | "online_only";
export type OfflineArea = "personal" | "professional" | "support" | "account";

export interface OfflineRoutePolicy {
  /** Prefixo da rota (`/pro` cobre `/pro/*`). */
  prefix: string;
  area: OfflineArea;
  /** Classe da leitura da tela. Acoes dentro dela podem ser mais restritas. */
  read: OfflineClass;
  /** Classe da escrita principal da tela. */
  write: OfflineClass;
  shell: OfflineShellMode;
  /** Explicacao curta mostrada quando a tela precisa de conexao. */
  explanation: string;
}

const ACCOUNT = "Perfil, configurações e segurança dependem da sua conta online. Nada foi alterado.";

export const OFFLINE_ROUTE_POLICY: readonly OfflineRoutePolicy[] = [
  // Nucleo pessoal (ADR-0014): le do aparelho; escrita vai para a fila.
  { prefix: "/dashboard", area: "personal", read: "READ_ONLY_OFFLINE", write: "QUEUEABLE", shell: "core", explanation: "" },
  { prefix: "/meu-humor", area: "personal", read: "READ_ONLY_OFFLINE", write: "QUEUEABLE", shell: "core", explanation: "" },
  { prefix: "/historico", area: "personal", read: "READ_ONLY_OFFLINE", write: "ONLINE_ONLY", shell: "core", explanation: "" },
  { prefix: "/diario", area: "personal", read: "READ_ONLY_OFFLINE", write: "QUEUEABLE", shell: "core", explanation: "" },
  { prefix: "/metas", area: "personal", read: "READ_ONLY_OFFLINE", write: "QUEUEABLE", shell: "core", explanation: "" },
  { prefix: "/ciclo", area: "personal", read: "READ_ONLY_OFFLINE", write: "QUEUEABLE", shell: "core", explanation: "" },
  { prefix: "/relatorios", area: "personal", read: "READ_ONLY_OFFLINE", write: "ONLINE_ONLY", shell: "core", explanation: "" },
  // Rede de Apoio: dado institucional ou texto publicado.
  { prefix: "/rede-de-apoio", area: "support", read: "READ_ONLY_OFFLINE", write: "ONLINE_ONLY", shell: "support", explanation: "" },
  { prefix: "/conteudos-de-apoio", area: "support", read: "READ_ONLY_OFFLINE", write: "ONLINE_ONLY", shell: "support", explanation: "" },
  // Sessoes: criar/abrir exige servidor; a captura local e parte da sessao ja criada.
  {
    prefix: "/sessoes",
    area: "personal",
    read: "ONLINE_ONLY",
    write: "ONLINE_ONLY",
    shell: "online_only",
    explanation: "Para começar ou abrir uma sessão é preciso conexão. Nada foi gravado ou enviado.",
  },
  {
    prefix: "/agenda",
    area: "personal",
    read: "ONLINE_ONLY",
    write: "NO_OFFLINE_BY_DESIGN",
    shell: "online_only",
    explanation: "Você precisa de conexão para participar desta sessão ou pedir um horário. Nenhum pedido foi enviado.",
  },
  {
    prefix: "/profissionais",
    area: "personal",
    read: "ONLINE_ONLY",
    write: "NO_OFFLINE_BY_DESIGN",
    shell: "online_only",
    explanation: "A lista de profissionais precisa estar atualizada (registro e disponibilidade), por isso só abre com conexão.",
  },
  {
    prefix: "/convite",
    area: "personal",
    read: "NO_OFFLINE_BY_DESIGN",
    write: "NO_OFFLINE_BY_DESIGN",
    shell: "online_only",
    explanation: "Aceitar um convite cria um vínculo na sua conta, e isso só acontece com conexão. Nada foi alterado.",
  },
  {
    prefix: "/pedidos",
    area: "personal",
    read: "ONLINE_ONLY",
    write: "ONLINE_ONLY",
    shell: "online_only",
    explanation: "Recados só são enviados com conexão. Nada foi enviado. Em risco imediato, use o botão SOS.",
  },
  {
    prefix: "/notificacoes",
    area: "personal",
    read: "ONLINE_ONLY",
    write: "ONLINE_ONLY",
    shell: "online_only",
    explanation: "As notificações vêm da sua conta online. Nenhuma foi marcada como lida.",
  },
  { prefix: "/configuracoes/privacidade", area: "account", read: "ONLINE_ONLY", write: "NO_OFFLINE_BY_DESIGN", shell: "online_only", explanation: "Compartilhamento e privacidade só mudam com conexão, para valerem na hora no servidor. Nada foi alterado." },
  { prefix: "/configuracoes", area: "account", read: "ONLINE_ONLY", write: "ONLINE_ONLY", shell: "online_only", explanation: ACCOUNT },
  { prefix: "/perfil", area: "account", read: "ONLINE_ONLY", write: "ONLINE_ONLY", shell: "online_only", explanation: ACCOUNT },
  { prefix: "/seguranca", area: "account", read: "ONLINE_ONLY", write: "NO_OFFLINE_BY_DESIGN", shell: "online_only", explanation: ACCOUNT },
  { prefix: "/area-profissional", area: "account", read: "ONLINE_ONLY", write: "NO_OFFLINE_BY_DESIGN", shell: "online_only", explanation: ACCOUNT },
  // Area profissional: dado de terceiro; nunca cache local.
  {
    prefix: "/pro/sessoes",
    area: "professional",
    read: "ONLINE_ONLY",
    write: "NO_OFFLINE_BY_DESIGN",
    shell: "online_only",
    explanation: "Você precisa de conexão para participar desta sessão. A sala nunca abre sem internet.",
  },
  {
    prefix: "/pro/agenda",
    area: "professional",
    read: "ONLINE_ONLY",
    write: "NO_OFFLINE_BY_DESIGN",
    shell: "online_only",
    explanation: "Confirmar, recusar ou abrir horários precisa de conexão, para a agenda nunca mostrar um horário que já mudou. Nada foi alterado.",
  },
  {
    prefix: "/pro",
    area: "professional",
    read: "ONLINE_ONLY",
    write: "NO_OFFLINE_BY_DESIGN",
    shell: "online_only",
    explanation: "Você precisa de conexão para acessar o ambiente profissional. Nenhum dado de acompanhamento fica guardado neste aparelho.",
  },
];

const DEFAULT_POLICY: OfflineRoutePolicy = {
  prefix: "",
  area: "personal",
  read: "ONLINE_ONLY",
  write: "ONLINE_ONLY",
  shell: "online_only",
  explanation: "Esta tela depende da sua conta online. Nada foi alterado.",
};

/** Politica da rota (prefixo mais longo). Rota desconhecida = `ONLINE_ONLY`. */
export function offlinePolicyFor(route: string): OfflineRoutePolicy {
  const path = route.split(/[?#]/, 1)[0] || "/";
  let best: OfflineRoutePolicy | null = null;
  for (const policy of OFFLINE_ROUTE_POLICY) {
    if (path === policy.prefix || path.startsWith(`${policy.prefix}/`)) {
      if (!best || policy.prefix.length > best.prefix.length) best = policy;
    }
  }
  return best ?? DEFAULT_POLICY;
}
