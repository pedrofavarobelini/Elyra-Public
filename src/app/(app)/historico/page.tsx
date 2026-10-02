import type { Metadata } from "next";

import { HistoryView } from "./view";

export const metadata: Metadata = { title: "Histórico" };

export default function HistoricoPage() {
  return <HistoryView />;
}
