import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { FullResult, Reporter } from "@playwright/test/reporter";

import { resolveEvidenceStage } from "../evidence-stage";
import {
  parseTransportNavigationRecovery,
  type TransportNavigationRecovery,
} from "../transport-navigation-recovery";


export default class TransportRecoveryReporter implements Reporter {
  private readonly recoveries: TransportNavigationRecovery[] = [];
  private stderrBuffer = "";

  onStdErr(chunk: string | Buffer) {
    this.stderrBuffer += chunk.toString();
    this.consumeCompleteLines();
  }

  onEnd(result: FullResult) {
    this.consumeLine(this.stderrBuffer);
    this.stderrBuffer = "";

    const stage = resolveEvidenceStage();
    const evidenceDir = resolve(
      process.cwd(),
      "test-results",
      stage,
    );
    mkdirSync(evidenceDir, { recursive: true });
    // Mesmo motivo do relatorio JSON: um arquivo por processo, senao o ultimo
    // viewport apaga a contagem dos anteriores e o total fica sem prova.
    const slot = process.env.ELYRA_E2E_SLOT ? `-${process.env.ELYRA_E2E_SLOT}` : "";
    writeFileSync(
      resolve(evidenceDir, `transport-navigation-recovery${slot}.json`),
      JSON.stringify(
        {
          schema_version: "elyra-transport-navigation-recovery/v1",
          playwright_status: result.status,
          count: this.recoveries.length,
          recoveries: this.recoveries,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    console.log(`TRANSPORT_NAVIGATION_RECOVERY=${this.recoveries.length}`);
  }

  private consumeCompleteLines() {
    const lines = this.stderrBuffer.split(/\r?\n/);
    this.stderrBuffer = lines.pop() ?? "";
    for (const line of lines) this.consumeLine(line);
  }

  private consumeLine(line: string) {
    const recovery = parseTransportNavigationRecovery(line);
    if (recovery) this.recoveries.push(recovery);
  }
}
