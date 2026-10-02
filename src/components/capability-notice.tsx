import { Badge } from "@/components/ui/badge";
import {
  CAPABILITY_STATUS,
  type CapabilityAssessment,
  type CapabilityStatus,
} from "@/lib/capabilities";

const STATUS_LABEL: Record<CapabilityStatus, string> = {
  [CAPABILITY_STATUS.SUPPORTED]: "Disponível",
  [CAPABILITY_STATUS.UNSUPPORTED_PLATFORM]: "Plataforma incompatível",
  [CAPABILITY_STATUS.UNSUPPORTED_BROWSER]: "Navegador incompatível",
  [CAPABILITY_STATUS.CAPABILITY_NOT_AVAILABLE]: "Indisponível agora",
  [CAPABILITY_STATUS.PERMISSION_DENIED]: "Permissão negada",
  [CAPABILITY_STATUS.EXTERNAL_CONFIGURATION_REQUIRED]: "Configuração externa pendente",
  [CAPABILITY_STATUS.NOT_CONFIGURED]: "Ainda não configurado",
};

export function CapabilityNotice({
  assessment,
  className = "",
}: {
  assessment: CapabilityAssessment;
  className?: string;
}) {
  return (
    <div role="note" className={`rounded-control border border-line bg-surface-muted px-3 py-2.5 ${className}`}>
      <Badge tone={assessment.status === CAPABILITY_STATUS.SUPPORTED ? "positive" : "neutral"}>
        {STATUS_LABEL[assessment.status]}
      </Badge>
      <p className="mt-2 text-sm text-ink">{assessment.reason}</p>
      {assessment.alternative ? (
        <p className="mt-1 text-sm text-ink-muted">{assessment.alternative}</p>
      ) : null}
    </div>
  );
}
