export function resolveEvidenceStage(environment: Readonly<Record<string, string | undefined>> = process.env): string {
  const run = environment.ELYRA_EVIDENCE_RUN?.trim() || "public-snapshot";
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(run)) throw new Error("Invalid local QA run identifier");
  return run;
}
