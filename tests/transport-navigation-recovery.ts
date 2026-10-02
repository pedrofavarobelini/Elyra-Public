/**
 * Linha estruturada emitida exclusivamente quando `gotoHydrated` usa a unica
 * recuperacao permitida para `net::ERR_ABORTED`.
 *
 * O marcador permite que um reporter conte a ocorrencia sem interpretar todo
 * o stderr do Playwright. O payload e deliberadamente minimo e sanitizado:
 * somente rota e viewport, nunca URL assinada, corpo, identidade ou token.
 */

export const TRANSPORT_RECOVERY_MARKER =
  "ELYRA_TRANSPORT_NAVIGATION_RECOVERY ";

export interface TransportNavigationRecovery {
  route: string;
  viewport: string;
}

export function formatTransportNavigationRecovery(
  recovery: TransportNavigationRecovery,
) {
  return TRANSPORT_RECOVERY_MARKER + JSON.stringify(recovery);
}

export function parseTransportNavigationRecovery(
  line: string,
): TransportNavigationRecovery | null {
  const marker = line.indexOf(TRANSPORT_RECOVERY_MARKER);
  if (marker < 0) return null;

  try {
    const parsed = JSON.parse(
      line.slice(marker + TRANSPORT_RECOVERY_MARKER.length).trim(),
    ) as Partial<TransportNavigationRecovery>;
    if (typeof parsed.route !== "string" || typeof parsed.viewport !== "string") {
      return null;
    }
    return { route: parsed.route, viewport: parsed.viewport };
  } catch {
    return null;
  }
}
