import type { Metadata } from "next";

import { JournalView } from "./view";

export const metadata: Metadata = { title: "Diário" };

export default function DiarioPage() {
  return <JournalView />;
}
