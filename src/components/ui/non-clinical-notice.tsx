import { ShieldCheck } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

export type NonClinicalContext =
  | "insight"
  | "report"
  | "session"
  | "cycle"
  | "professional";

/**
 * Aviso nao clinico.
 *
 * NAO e rodape legal opcional: e componente de produto obrigatorio em toda
 * superficie que interpreta dados. Ver docs/01-Product/Non-Clinical-Language.md
 * e as figuras 1, 2, 4, 7 e 8.
 */
const MESSAGES: Record<NonClinicalContext, string> = {
  insight:
    "A Elyra oferece insights para apoiar seu bem-estar, mas não fornece diagnóstico clínico ou substitui orientação profissional.",
  report:
    "Este relatório é informativo e não representa diagnóstico, avaliação clínica ou substitui orientação de profissionais de saúde.",
  session:
    "A interpretação dos sinais não determina um estado emocional. Siga acompanhando seus padrões ao longo do tempo.",
  cycle:
    "O acompanhamento do ciclo é uma ferramenta de apoio e autoconhecimento. Não é um diagnóstico médico e não substitui orientação profissional.",
  professional:
    "Os gráficos combinam dados informados pela pessoa com sinais automatizados. Esses insights não representam diagnóstico.",
};

export function NonClinicalNotice({
  context,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { context: NonClinicalContext }) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-3 rounded-control bg-surface-brand p-4 text-sm text-brand-800",
        className,
      )}
      {...props}
    >
      <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>{children ?? MESSAGES[context]}</p>
    </div>
  );
}

export { MESSAGES as NON_CLINICAL_MESSAGES };
