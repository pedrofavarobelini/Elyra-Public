import type { Route } from "next";
import Link from "next/link";

import { PrivacyRights } from "@/app/(app)/configuracoes/privacy-rights";
import { PageHeader } from "@/components/journey/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";


export function DataRightsContent({ hubHref, privacyHref }: { hubHref: string; privacyHref: string }) {
  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={hubHref as Route}
            className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 hover:underline lg:min-h-0"
          >
            ← Voltar para o hub de ajustes
          </Link>
        }
        title="Seus dados"
        description="Leve seus dados com você ou encerre sua conta quando quiser."
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(20rem,1fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <PrivacyRights />
        </div>
        <Card variant="muted">
          <CardHeader>
            <CardTitle>Antes de decidir</CardTitle>
            <CardDescription>
              A exportação não apaga nada. A exclusão apaga, e não tem volta.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-ink-muted">
            <p>
              O arquivo exportado sai da mesma fonte que conta o que existe sobre
              você em{" "}
              <Link
                href={privacyHref as Route}
                className="font-medium text-brand-700 hover:underline"
              >
                Privacidade e consentimento
              </Link>
              .
            </p>
            <p>
              Guarde o arquivo em lugar seguro: ele contém seus registros, incluindo
              o diário.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
