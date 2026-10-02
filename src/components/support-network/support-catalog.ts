import type { SupportMunicipality } from "@/lib/contracts/support-network";



export const UF_NAMES: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AM: "Amazonas", AP: "Amapá", BA: "Bahia", CE: "Ceará",
  DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MG: "Minas Gerais",
  MS: "Mato Grosso do Sul", MT: "Mato Grosso", PA: "Pará", PB: "Paraíba", PE: "Pernambuco",
  PI: "Piauí", PR: "Paraná", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RO: "Rondônia",
  RR: "Roraima", RS: "Rio Grande do Sul", SC: "Santa Catarina", SE: "Sergipe", SP: "São Paulo",
  TO: "Tocantins",
};

export const foldText = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export type SupportStateGroup = {
  state: string;
  stateName: string;
  municipalities: SupportMunicipality[];
  facilityCount: number;
};

/** Agrupa por UF (ordem alfabetica do nome do estado); municipios em ordem alfabetica. */
export function groupByState(
  municipalities: SupportMunicipality[],
  filter: { text?: string; state?: string } = {},
): SupportStateGroup[] {
  const needle = foldText(filter.text ?? "");
  const groups = new Map<string, SupportStateGroup>();
  for (const item of municipalities) {
    if (filter.state && item.state !== filter.state) continue;
    const stateName = UF_NAMES[item.state] ?? item.state;
    if (needle && !foldText(`${item.name ?? item.code} ${stateName} ${item.state}`).includes(needle)) continue;
    const group = groups.get(item.state) ?? { state: item.state, stateName, municipalities: [], facilityCount: 0 };
    group.municipalities.push(item);
    group.facilityCount += item.facilityCount;
    groups.set(item.state, group);
  }
  const collator = new Intl.Collator("pt-BR");
  for (const group of groups.values()) {
    group.municipalities.sort((a, b) => collator.compare(a.name ?? a.code, b.name ?? b.code));
  }
  return [...groups.values()].sort((a, b) => collator.compare(a.stateName, b.stateName));
}

export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
