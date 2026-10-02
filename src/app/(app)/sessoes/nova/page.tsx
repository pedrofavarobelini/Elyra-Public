import type { Metadata } from "next";

import { Stage11LiveCaptureView } from "./capture-view";

export const metadata: Metadata = { title: "Sessão em andamento" };

export default function NovaSessaoPage() {
  return <Stage11LiveCaptureView />;
}
