import {
  BadgeCheck,
  BarChart3,
  BookOpen,
  CalendarDays,
  Flower2,
  FileText,
  Inbox,
  LayoutGrid,
  LineChart,
  Settings,
  ShieldCheck,
  Smile,
  Target,
  User,
  UserRoundSearch,
  Users,
  Video,
  MessageSquareText,
} from "lucide-react";
import type { Route } from "next";
import type { LucideIcon } from "lucide-react";

/**
 * Grupo de navegacao. `label` ausente = grupo sem cabecalho (ex.: globais).
 */
export interface NavGroup {
  label?: string;
  entries: NavEntry[];
}

export interface NavEntry {

  href: Route;
  label: string;
  icon: LucideIcon;
  /**
   * Prefixos extras que tambem marcam o item como ativo. Ex.: a sessao com
   * profissional (`/agenda`) e parte de "Sessoes" (ADR-0029).
   */
  match?: string[];
}


export const USER_NAV_GROUPS: NavGroup[] = [
  {
    label: "Visão geral",
    entries: [{ href: "/dashboard", label: "Dashboard", icon: LayoutGrid }],
  },
  {
    label: "Meus registros",
    entries: [
      { href: "/diario", label: "Diário", icon: FileText },
      { href: "/meu-humor", label: "Meu Humor", icon: Smile },
      { href: "/metas", label: "Metas", icon: Target },
      { href: "/ciclo", label: "Ciclo", icon: Flower2 },
      { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
    ],
  },
  {
    label: "Sessões e acompanhamento",
    entries: [
      { href: "/sessoes", label: "Sessões", icon: CalendarDays, match: ["/agenda"] },
      { href: "/profissionais", label: "Encontrar profissionais", icon: UserRoundSearch },
      { href: "/pedidos", label: "Recados ao profissional", icon: MessageSquareText },
    ],
  },
  {

    label: "Ajuda e informação",
    entries: [
      // SUP-3 (ADR-0033): informacao editorial curada; nao e SOS nem diretorio.
      // "Rede de Apoio" EDITORIAL (artigos + fontes confiaveis). A Rede de
      // Apoio de SERVICOS (mapa) entra so pelo SOS. Rota mantida (retrocompat.).
      { href: "/conteudos-de-apoio", label: "Rede de Apoio", icon: BookOpen },
    ],
  },
  {
    label: "Conta",
    entries: [
      { href: "/perfil", label: "Perfil", icon: User },
      { href: "/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
];

export const USER_NAV: NavEntry[] = USER_NAV_GROUPS.flatMap((group) => group.entries);



export const PROFESSIONAL_NAV_GROUPS: NavGroup[] = [
  {
    label: "Visão geral",
    entries: [{ href: "/pro/dashboard", label: "Dashboard", icon: LayoutGrid }],
  },
  {
    label: "Trabalho",
    entries: [
      { href: "/pro/acompanhamentos", label: "Acompanhamentos", icon: Users },
      { href: "/pro/agenda", label: "Agenda", icon: CalendarDays },
      { href: "/pro/sessoes", label: "Sessões", icon: Video },
      { href: "/pro/relatorios", label: "Relatórios e evolução", icon: LineChart },
    ],
  },
  {
    label: "Relacionamento",
    entries: [
      { href: "/pro/solicitacoes", label: "Central de solicitações", icon: Inbox },
      { href: "/pro/pedidos", label: "Recados das pessoas", icon: MessageSquareText },
      { href: "/pro/vinculos", label: "Vínculos e acessos", icon: ShieldCheck },
    ],
  },
  {
    label: "Profissional",
    entries: [{ href: "/pro/perfil", label: "Perfil profissional", icon: BadgeCheck }],
  },
  {
    // F4 (ADR-0027): configuracoes do proprio contexto; secoes globais compartilhadas.
    entries: [{ href: "/pro/configuracoes", label: "Configurações", icon: Settings }],
  },
];

export const PROFESSIONAL_NAV: NavEntry[] = PROFESSIONAL_NAV_GROUPS.flatMap(
  (group) => group.entries,
);

export type NavContext = "user" | "professional";

export function navGroupsFor(context: NavContext): NavGroup[] {
  return context === "professional" ? PROFESSIONAL_NAV_GROUPS : USER_NAV_GROUPS;
}

export function navFor(context: NavContext): NavEntry[] {
  return context === "professional" ? PROFESSIONAL_NAV : USER_NAV;
}
