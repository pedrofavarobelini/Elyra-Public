import type { Metadata } from "next";

import { GoalsView } from "./view";

export const metadata: Metadata = { title: "Metas" };

export default function MetasPage() {
  return <GoalsView />;
}
