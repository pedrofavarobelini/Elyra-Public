import type { Metadata } from "next";

import { ReportsView } from "./view";

export const metadata: Metadata = { title: "Relatórios" };

export default function RelatoriosPage() {
  return <ReportsView />;
}
