import type { Metadata } from "next";

import { CheckinView } from "./view";

export const metadata: Metadata = { title: "Meu Humor" };

export default function MeuHumorPage() {
  return <CheckinView />;
}
