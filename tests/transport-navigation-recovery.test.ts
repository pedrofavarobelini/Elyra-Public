import { describe, expect, it } from "vitest";

import {
  formatTransportNavigationRecovery,
  parseTransportNavigationRecovery,
} from "./transport-navigation-recovery";

describe("auditoria da recuperacao de navegacao", () => {
  it("preserva somente rota e viewport no registro estruturado", () => {
    const event = { route: "/configuracoes", viewport: "375x667" };
    expect(parseTransportNavigationRecovery(formatTransportNavigationRecovery(event)))
      .toEqual(event);
  });

  it("ignora stderr comum e payload incompleto", () => {
    expect(parseTransportNavigationRecovery("warning comum")).toBeNull();
    expect(
      parseTransportNavigationRecovery(
        "ELYRA_TRANSPORT_NAVIGATION_RECOVERY {\"route\":\"/\"}",
      ),
    ).toBeNull();
  });
});
