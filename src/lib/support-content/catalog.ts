import type { ContentItem } from "./content-model";
import { CONTENT_CATEGORIES, type ContentCategory } from "./policy";

/**
 * SUP-3 — busca e filtro NO CLIENTE (corpus pequeno e local; nenhuma API).
 * Busca sem acento e sem caixa em titulo, resumo, categoria e fonte.
 */
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function isContentCategory(value: string | null | undefined): value is ContentCategory {
  return !!value && Object.prototype.hasOwnProperty.call(CONTENT_CATEGORIES, value);
}

export function filterContent(items: readonly ContentItem[], query: string, category: ContentCategory | null): ContentItem[] {
  const terms = fold(query.slice(0, 80)).split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (category && item.category !== category) return false;
    if (!terms.length) return true;
    const haystack = fold(`${item.title} ${item.summary} ${CONTENT_CATEGORIES[item.category].label} ${item.publisherName}`);
    return terms.every((term) => haystack.includes(term));
  });
}

/** "2026-09-27" -> "27/09/2026", sem fuso (data civil). */
export function formatContentDate(iso: string | null): string | null {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

export const SUPPORT_CONTENT_COPY = {
  /* "Rede de Apoio" EDITORIAL (menu). A Rede de Apoio de SERVICOS (mapa) entra pelo SOS. */
  title: "Rede de Apoio",
  description: "Informações, orientações e fontes confiáveis para cuidar da sua saúde mental.",
  externalTitle: "Recursos confiáveis",
  externalNotice: "Informação e apoio de instituições sérias. Não são serviços de emergência: em risco imediato, use o botão SOS.",
  externalAction: "Acessar site",
  mapTitle: "Encontrar serviços de apoio",
  mapDescription: "Unidades de saúde e serviços, como UBS e CAPS, no mapa e na lista. Também está no botão SOS. Não é emergência.",
  mapAction: "Ver mapa de unidades",
  notice:
    "Conteúdos informativos. Não substituem atendimento profissional. Em risco imediato, use o botão SOS.",
  preview: "Pré-visualização editorial — conteúdos em revisão, ainda não publicados. Não aparecem para quem usa a Elyra.",
  empty: "Ainda não há conteúdos publicados. Enquanto isso, a Rede de Apoio e o botão SOS continuam disponíveis.",
  noMatch: "Nenhum conteúdo corresponde à busca.",
  originalLink: "Ler na fonte original",
  archived: "Este conteúdo foi arquivado e não está mais disponível.",
} as const;
