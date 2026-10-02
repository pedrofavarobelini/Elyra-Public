
export const SOS_CAPABILITY = {
  /** Nenhum endpoint, tabela ou log de SOS existe. */
  backend: "NONE",
  /**
   * Existem recursos publicos externos (SAMU 192, Policia Militar 190, CVV 188
   * e o chat oficial do CVV), mas so a pessoa os aciona, por toque proprio.
   */
  externalResources: "USER_INITIATED_PUBLIC_RESOURCES",
  /** A Elyra nao guarda contato pessoal nem liga/avisa ninguem por conta propria. */
  externalContacts: "USER_INITIATED_ONLY",
  /** Localizacao nunca e lida, pedida ou enviada. */
  locationUsage: "NONE",
  /** Nada e discado, enviado ou notificado sem o toque da pessoa. */
  automaticDispatch: "NEVER",
  /** Abrir o painel ou tocar num contato nao gera log, evento nem contador. */
  telemetry: "NONE",
} as const;

export const SOS_NO_AUTOMATIC_DISPATCH =
  "A Elyra não aciona serviços de emergência automaticamente.";

export interface HelpContact {
  id: string;
  name: string;
  detail: string;
  /** `tel:` so abre o discador; a ligacao e decisao da pessoa. */
  href: `tel:${string}` | `https://${string}`;
  action: string;
}

export interface HelpGroup {
  id: string;
  title: string;
  description: string;
  contacts: HelpContact[];
}

/**
 * Servicos publicos brasileiros de numero curto e gratuito.
 *
 * Fonte: numeracao de utilidade publica regulada pela Anatel (192 SAMU,
 * 190 Policia Militar) e o 188 do Centro de Valorizacao da Vida (CVV),
 * gratuito em todo o pais; chat em cvv.org.br. Lista unica e revisavel: mudar
 * um numero e editar este arquivo, com teste. Fora do Brasil, o painel diz para
 * usar o numero local.
 */
export const HELP_GROUPS: HelpGroup[] = [
  {
    id: "risco",
    title: "Risco imediato à vida",
    description: "Se você ou alguém corre perigo agora.",
    contacts: [
      { id: "samu", name: "SAMU", detail: "Emergência médica · 192", href: "tel:192", action: "Ligar 192" },
      { id: "policia", name: "Polícia Militar", detail: "Violência ou ameaça · 190", href: "tel:190", action: "Ligar 190" },
    ],
  },
  {
    id: "apoio",
    title: "Apoio emocional 24 horas",
    description: "Conversa sigilosa e gratuita com voluntários do CVV.",
    contacts: [
      { id: "cvv", name: "CVV", detail: "Ligação gratuita · 188", href: "tel:188", action: "Ligar 188" },
      {
        id: "cvv-site",
        name: "CVV por chat",
        detail: "Site externo · precisa de internet",
        href: "https://cvv.org.br",
        action: "Abrir site",
      },
    ],
  },
];
