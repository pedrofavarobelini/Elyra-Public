import { permanentRedirect } from "next/navigation";

/** Rota legada (fig. 8). ADR-0020: "Pacientes" passou a "Acompanhamentos". */
export default function LegacyPacientesPage() {
  permanentRedirect("/pro/acompanhamentos");
}
