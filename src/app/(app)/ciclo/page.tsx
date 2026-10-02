import type { Metadata } from "next";

import { CycleGate } from "./view";

export const metadata: Metadata = { title: "Ciclo" };

export default function CicloPage() {
  return <CycleGate />;
}
