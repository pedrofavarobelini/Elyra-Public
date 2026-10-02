import Link from "next/link";

import { HelpRequestList } from "@/components/help-requests/help-request-list";
import { PageHeader } from "@/components/journey/page-header";
import { BlockError } from "@/components/professional/portal-bits";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HELP_REQUEST_COPY, type HelpRequest } from "@/lib/contracts/help-requests";
import { InlineEmpty } from "@/components/states";

export function ProHelpRequestsView({ requests }: { requests: HelpRequest[] | null }) {
  const waiting = requests?.filter((item) => item.status === "open" || item.status === "seen") ?? [];
  const others = requests?.filter((item) => item.status !== "open" && item.status !== "seen") ?? [];
  return (
    <>
      <PageHeader
        title="Recados das pessoas"
        description="Mensagens curtas de quem você acompanha. Só aparecem enquanto o vínculo está ativo."
      />
      <p className="mb-5 max-w-prose rounded-control bg-surface-muted px-3.5 py-3 text-sm text-ink-muted lg:mb-6" data-testid="help-request-pro-note">
        {HELP_REQUEST_COPY.professionalNote}{" "}
        <Link href="/pro/agenda" className="font-medium text-brand-700 underline-offset-4 hover:underline">
          Abrir agenda
        </Link>
      </p>
      {requests === null ? (
        <BlockError what="os recados" />
      ) : (
        <div className="grid items-start gap-5 lg:gap-6 xl:grid-cols-2" data-layout="columns">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Aguardando</CardTitle>
              <CardDescription>Enviados ou lidos, ainda sem resposta marcada.</CardDescription>
            </CardHeader>
            <CardContent>
              <HelpRequestList
                requests={waiting}
                empty={<InlineEmpty>Nenhum recado aguardando.</InlineEmpty>}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2">Anteriores</CardTitle>
              <CardDescription>Respondidos, encerrados, cancelados ou expirados.</CardDescription>
            </CardHeader>
            <CardContent>
              <HelpRequestList
                requests={others}
                empty={<p className="text-sm text-ink-muted">Nada por aqui ainda.</p>}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
