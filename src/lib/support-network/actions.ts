import type { SupportFacility } from "@/lib/contracts/support-network";

/**
 * SUP-2 — acoes da unidade. Tudo aqui so MONTA um link; quem aciona e a pessoa,
 * com um toque. Nada vem pronto da fonte: protocolo, host e parametros sao da
 * Elyra; da fonte so entram digitos e texto codificado.
 */

/**
 * `tel:` so com digitos (8 a 13, a faixa aceita no SUP-1). Qualquer outra
 * coisa — letras, `javascript:`, URL, `+` no meio — devolve `null` e o botao
 * "Ligar" simplesmente nao aparece.
 */
export function supportTelHref(phone: SupportFacility["phone"]): `tel:${string}` | null {
  const digits = phone?.digits ?? null;
  if (!digits || !/^[0-9]{8,13}$/.test(digits)) return null;
  return `tel:${digits}`;
}

/** Endereco da UNIDADE em uma linha, so com o que existe. */
export function supportAddressLine(facility: SupportFacility): string {
  const { street, number, district } = facility.address;
  const first = [street, number].filter(Boolean).join(", ");
  const place = [facility.municipality.name, facility.state].filter(Boolean).join(" / ");
  return [first, district, place].filter(Boolean).join(" · ");
}

/**
 * "Abrir rota": URL universal de mapas (abre o app do aparelho ou o site) com
 * o DESTINO apenas. Nunca inclui a origem: a posicao da pessoa fica com o app
 * que ela escolher. Com coordenada valida, so numeros; sem ela, o endereco
 * codificado. Sem nenhum dos dois, nao ha rota.
 */
export function supportRouteUrl(facility: SupportFacility): string | null {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  if (facility.coordinates && facility.coordinateStatus === "valid") {
    const { latitude, longitude } = facility.coordinates;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    url.searchParams.set("destination", `${latitude.toFixed(6)},${longitude.toFixed(6)}`);
    return url.toString();
  }
  if (!facility.address.street) return null;
  url.searchParams.set("destination", supportAddressLine(facility).replace(/ · /g, ", "));
  return url.toString();
}
