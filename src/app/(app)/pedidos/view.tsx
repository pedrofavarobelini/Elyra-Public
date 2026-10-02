import { MessageSquareText } from "lucide-react";
import Link from "next/link";

import { HelpContacts } from "@/components/help/help-contacts";
import { HelpRequestForm } from "@/components/help-requests/help-request-form";
import { HelpRequestList } from "@/components/help-requests/help-request-list";
import { PageHeader } from "@/components/journey/page-header";
import { BlockError } from "@/components/professional/portal-bits";
import { EmptyState } from "@/components/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { HELP_REQUEST_COPY, type HelpRequest, type HelpRequestTarget } from "@/lib/contracts/help-requests";

export function HelpRequestsPersonView({
  requests,
  targets,
}: {
  requests: HelpRequest[] | null;
  targets: HelpRequestTarget[] | null;
}) {
  return (
    <>
      <PageHeader
        title="Recados ao profissional"
        description="Uma mensagem curta para quem já acompanha você."
      />

      <div className="grid items-start gap-5 lg:gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]" data-layout="columns">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Novo recado</CardTitle>
            <CardDescription>{HELP_REQUEST_COPY.howItWorks}</CardDescription>
          </CardHeader>
          <CardContent>
            {targets === null ? (
              <BlockError what="os seus acompanhamentos" />
            ) : targets.length === 0 ? (
              <div className="flex flex-col gap-4">
                <div className="rounded-control border border-attention/30 bg-attention-soft px-3.5 py-3 text-sm text-ink">
                  {HELP_REQUEST_COPY.limit}
                </div>
                <EmptyState
                  size="compact"
                  icon={<MessageSquareText />}
                  title="Nenhum profissional disponível para recados"
                  description={HELP_REQUEST_COPY.noTargets}
                  action={<Link className="text-sm font-medium text-brand-700 underline-offset-4 hover:underline" href="/profissionais">Encontrar profissional</Link>}
                />
              </div>
            ) : (
              <HelpRequestForm targets={targets} />
            )}
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-5 lg:gap-6">
          {/*
            L-398: a lista SAMU/Policia/CVV ja mora no SOS. Aqui fica UMA linha e
            os contatos fechados — o fallback continua: com o teclado aberto no
            celular o SOS sai de cena, e o link do aviso abre estes contatos.
          */}
          <Card variant="muted" className="scroll-mt-24" data-testid="help-request-sos">
            <CardContent className="flex flex-col gap-2 pt-5">
              <p className="text-sm text-ink">Em risco imediato, use o botão SOS.</p>
              <Disclosure summary="Contatos de ajuda imediata">
                <div id="contatos-ajuda" className="scroll-mt-24 pt-2">
                  <HelpContacts />
                </div>
              </Disclosure>
            </CardContent>
          </Card>
          <Card variant="muted">
            <CardContent className="pt-5">
              <p className="text-sm font-medium text-ink">O que acontece com o texto</p>
              <p className="mt-1 text-sm text-ink-muted">{HELP_REQUEST_COPY.retention}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-5 lg:mt-6">
        <CardHeader>
          <CardTitle as="h2">Meus recados</CardTitle>
          <CardDescription>Enviado, lido, respondido: só o que aconteceu, sem prazo.</CardDescription>
        </CardHeader>
        <CardContent>
          {requests === null ? (
            <BlockError what="os seus recados" />
          ) : (
            <HelpRequestList
              requests={requests}
              empty={<p className="text-sm text-ink-muted">Você ainda não enviou nenhum recado.</p>}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
