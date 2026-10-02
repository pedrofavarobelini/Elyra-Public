import type { SupportFreshness, SupportProvenance } from "@/lib/contracts/support-network";

/**
 * SUP-2 — textos da Rede de Apoio num unico lugar (linguagem nao clinica).
 *
 * Nunca: "mais indicado", "melhor", "aberto", "tem vaga", "atende saude
 * mental", "nao existem servicos na sua regiao". A fonte pode estar incompleta
 * e a Elyra nao escolhe unidade pela pessoa.
 */
export const SUPPORT_COPY = {
  title: "Rede de Apoio",
  description: "Serviços e unidades de saúde no mapa e na lista, com dados de fontes oficiais.",
  notEmergency: "Não é serviço de emergência. Em risco imediato, ligue 192.",
  confirmBeforeGoing:
    "Horário, atendimento e disponibilidade não constam na fonte. Confirme por telefone antes de ir.",
  demoBanner: "Ambiente de demonstração — unidades fictícias.",
  demoDetail: "Estes estabelecimentos não existem. Servem só para mostrar como a Rede de Apoio funciona.",
  noData:
    "A Rede de Apoio ainda não tem dados disponíveis. Os contatos de ajuda imediata continuam acessíveis a qualquer momento.",
  empty: "Nenhum serviço foi encontrado com os dados disponíveis.",
  emptyHint: "A fonte pode estar incompleta. Tente outro município ou remova o filtro.",
  error: "Não foi possível carregar a lista agora. Tente novamente em instantes.",
  mapUnavailable: "Não foi possível carregar o mapa. A lista continua disponível.",
  mapRegion: "Mapa das unidades da lista",
  locationIdle: "Você também pode usar sua localização para ordenar por distância aproximada.",
  locationRequesting: "Aguardando a permissão de localização do navegador…",
  locationDenied: "Localização não autorizada. Você ainda pode buscar por município.",
  locationUnavailable: "Não foi possível obter sua localização neste aparelho. Você ainda pode buscar por município.",
  locationTimeout: "A localização demorou demais para responder. Você ainda pode buscar por município.",
  locationOutside: "Não encontramos um município com dados perto de você. Escolha um município na busca.",
  locationPrivacy: "Sua localização fica só neste aparelho: não é enviada à Elyra nem guardada.",
  distanceNote: "Distância em linha reta, não é rota.",
  routeOffline: "Abrir rota precisa de internet.",
  offline: (savedAt: string) => `Sem conexão · lista salva em ${savedAt} · pode estar desatualizada.`,
} as const;

/** Frescor (SUP-1) em linguagem de produto. Envelhecer NAO e fechar. */
export function supportFreshnessCopy(freshness: SupportFreshness, referenceLabel: string): string {
  if (freshness === "CURRENT") return `Dados oficiais atualizados · competência ${referenceLabel}`;
  if (freshness === "AGING") return `Informação de ${referenceLabel}`;
  return `Esta informação pode estar desatualizada (competência ${referenceLabel}).`;
}

/** "2026-08-01" -> "08/2026" (competencia mensal; sem fuso). */
export function supportReferenceLabel(referenceDate: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}/.exec(referenceDate);
  return match ? `${match[2]}/${match[1]}` : referenceDate;
}

/** Fonte legivel. Fixture sempre anunciada como demonstracao. */
export function supportSourceLabel(provenance: SupportProvenance): string {
  return provenance.isFixture ? "Dados de demonstração (fictícios)" : "CNES / DATASUS — Ministério da Saúde";
}
