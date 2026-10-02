import { BadgeCheck, CircleDashed, FlaskConical } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEMO_VERIFICATION_COPY } from "@/lib/contracts/professional-directory";
import { formatDate } from "@/lib/professional/portal";

/** Frase obrigatoria (prompt mestre F6): aparece sempre junto do bloco. */
export const VERIFICATION_DISCLAIMER =
  "A verificação confirma as informações apresentadas e não representa avaliação da qualidade profissional.";

export interface TrustCredential {
  kind: string;
  title: string;
  institution: string;
  start_year: number | null;
  end_year: number | null;
  expires_on: string | null;
  trust_state: string;
  verified_at: string | null;
}

const KIND_LABEL: Record<string, string> = {
  education: "Formação",
  experience: "Experiência",
  certification: "Certificação",
};

function period(item: TrustCredential) {
  if (item.kind === "certification") return item.expires_on ? `válida até ${formatDate(item.expires_on)}` : null;
  if (!item.start_year) return null;
  return `${item.start_year}${item.end_year ? `–${item.end_year}` : "–atual"}`;
}

/**
 * "O que a Elyra verificou" (F6). So fatos e quem os conferiu. Sem nota,
 * estrela, ranking, "top" ou "recomendado"; sem CPF, RG, documento,
 * endereco, reviewer ou evidencia — a RPC nem devolve esses campos.
 */
export function TrustFacts({
  registration,
  verifiedAt,
  identityVerified = false,
  demo = false,
  credentials,
  credentialsAvailable,
}: {
  registration: string | null;
  verifiedAt: string | null;
  /** Verificacao V2: so quando a identidade foi conferida por fonte real. */
  identityVerified?: boolean;
  /** Seed administrativo de staging/local: nunca equivale a verificacao oficial. */
  demo?: boolean;
  credentials: TrustCredential[];
  credentialsAvailable: boolean;
}) {
  return (
    <Card data-testid="trust-facts">
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2 text-base">
          {demo ? (
            <FlaskConical className="size-4 text-attention" aria-hidden="true" />
          ) : (
            <BadgeCheck className="size-4 text-identity-700" aria-hidden="true" />
          )}
          {demo ? "Perfil de demonstração" : "O que a Elyra verificou"}
        </CardTitle>
        <p className="text-sm text-ink-muted" data-testid="verification-disclaimer">
          {demo ? DEMO_VERIFICATION_COPY : VERIFICATION_DISCLAIMER}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <ul className="grid gap-2 lg:grid-cols-2">
          {identityVerified && !demo ? (
            <li className="flex items-start gap-3 rounded-control border border-line px-3.5 py-3" data-testid="trust-identity">
              <BadgeCheck className="mt-0.5 size-4 shrink-0 text-identity-700" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">Identidade</p>
                <p className="text-ink-muted">A pessoa por trás do perfil é a titular do registro.</p>
              </div>
              <Badge tone="identity">Verificado</Badge>
            </li>
          ) : null}
          {registration ? (
            <li className="flex items-start gap-3 rounded-control border border-line px-3.5 py-3">
              {demo ? (
                <FlaskConical className="mt-0.5 size-4 shrink-0 text-attention" aria-hidden="true" />
              ) : (
                <BadgeCheck className="mt-0.5 size-4 shrink-0 text-identity-700" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">Registro no conselho · {registration}</p>
                <p className="text-ink-muted">
                  {demo
                    ? DEMO_VERIFICATION_COPY
                    : `Consultado na fonte oficial${verifiedAt ? ` em ${formatDate(verifiedAt)}` : ""}; estava ativo nessa data.`}
                </p>
              </div>
              <Badge tone={demo ? "attention" : "identity"}>{demo ? "Demonstração" : "Verificado"}</Badge>
            </li>
          ) : null}
          {credentials.map((item, index) => {
            const verified = item.trust_state === "verified";
            const simulated = demo && verified;
            const when = period(item);
            return (
              <li
                key={`${item.kind}-${index}`}
                className="flex items-start gap-3 rounded-control border border-line px-3.5 py-3"
                data-trust-state={item.trust_state}
              >
                {verified && !demo ? (
                  <BadgeCheck className="mt-0.5 size-4 shrink-0 text-identity-700" aria-hidden="true" />
                ) : simulated ? (
                  <FlaskConical className="mt-0.5 size-4 shrink-0 text-attention" aria-hidden="true" />
                ) : (
                  <CircleDashed className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">
                    {KIND_LABEL[item.kind] ?? item.kind} · {item.title}
                  </p>
                  <p className="text-ink-muted">
                    {[item.institution, when].filter(Boolean).join(" · ")}
                    {simulated
                      ? " · verificação simulada para homologação"
                      : verified && item.verified_at
                        ? ` · conferido em ${formatDate(item.verified_at)}`
                        : ""}
                  </p>
                </div>
                <Badge tone={simulated ? "attention" : verified ? "identity" : "neutral"}>
                  {simulated ? "Simulado" : verified ? "Verificado" : "Declarado"}
                </Badge>
              </li>
            );
          })}
        </ul>
        {!credentialsAvailable ? (
          <p className="text-ink-muted">Formação e experiência não puderam ser carregadas agora.</p>
        ) : null}
        <p className="text-ink-muted">
          “Declarado” é o que o próprio perfil informou, sem conferência. Apresentação, áreas, modalidade, idiomas e
          local também são declarados.
        </p>
      </CardContent>
    </Card>
  );
}
