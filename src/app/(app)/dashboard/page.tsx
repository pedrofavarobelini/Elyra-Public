import type { Metadata } from "next";

import { DashboardView } from "./view";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return <DashboardView />;
}
