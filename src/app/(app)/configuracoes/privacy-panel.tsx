import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import type { ConsentHistory } from "@/lib/contracts/consent";
import type { DataInventory } from "@/lib/contracts/data-inventory";



function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function PrivacyPanel({
  inventory,
  consents,
  inventoryUnavailable = false,
  consentsUnavailable = false,
}: {
  inventory: DataInventory;
  consents: ConsentHistory;
  inventoryUnavailable?: boolean;
  consentsUnavailable?: boolean;
}) {
  const comRegistro = inventory.domains.filter((domain) => domain.records > 0);
  const semRegistro = inventory.domains.filter((domain) => domain.records === 0);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>O que existe sobre você</CardTitle>
          <CardDescription>
            Contagem real, lida da mesma fonte que gera a sua exportação.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {inventoryUnavailable ? (
            <p role="alert" className="text-sm text-destructive">
              Não foi possível carregar o inventário dos seus dados. Os controles
              abaixo continuam funcionando.
            </p>
          ) : (
            <>
              <dl className="flex flex-col divide-y divide-line">
                {comRegistro.map((domain) => (

                  <div
                    key={domain.domain}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-2.5 first:pt-0"
                  >
                    <dt className="text-ink">{domain.label}</dt>
                    <dd className="font-semibold tabular-nums text-ink">
                      {domain.records}
                    </dd>
                  </div>
                ))}
              </dl>

              {/*
                Dominio sem registro aparece — em uma linha, e nao some. "Voce
                nao tem nada de ciclo" e uma resposta; a ausencia da linha
                deixaria a duvida entre nao existir e nao ter sido mostrado.
              */}
              {semRegistro.length > 0 ? (
                <p className="text-sm text-ink-subtle">
                  Sem nenhum registro em:{" "}
                  {semRegistro.map((domain) => domain.label).join(" · ")}.
                </p>
              ) : null}

              <p className="text-sm font-medium text-ink">
                Total de {inventory.total} registro(s).
              </p>

              <Disclosure summary="O que entra em cada contagem">
                <ul className="mt-1 flex flex-col gap-2">
                  {comRegistro.map((domain) => (
                    <li key={domain.domain}>
                      <span className="font-medium text-ink">{domain.label}:</span>{" "}
                      {domain.description}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-ink-subtle">
                  Fora desta contagem, por decisão declarada:{" "}
                  {inventory.excluded.join(", ")} — anotação clínica pertence ao
                  profissional, e trilha de auditoria e estado de exclusão são
                  registros internos do sistema.
                </p>
              </Disclosure>
            </>
          )}

          <div
            data-testid="privacy-how-to-change"
            className="rounded-control bg-surface-muted p-3 text-sm text-ink-muted"
          >
            <p className="font-medium text-ink">Como você muda isso</p>
            <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
              <li>Exportar e excluir: <strong>Seus dados</strong></li>
              <li>Quem pode ver: <strong>Compartilhamento com profissional</strong></li>
              <li>Ligar e desligar: <strong>Acompanhamento</strong></li>
              <li>Avisos: <strong>Notificações</strong></li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card id="cfg-consentimentos" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>Histórico de consentimento</CardTitle>
          <CardDescription>
            Cada concessão e cada revogação, com a data e a versão do documento.
            Nada aqui é apagado: revogar cria um registro novo.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {consentsUnavailable ? (
            <p role="alert" className="text-sm text-destructive">
              Não foi possível carregar seu histórico de consentimento.
            </p>
          ) : consents.purposes.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Ainda não há consentimento registrado nesta conta.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {consents.purposes.map((purpose) => (
                <li
                  key={purpose.purpose}
                  className="rounded-card border border-line bg-surface p-3.5 sm:p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink">{purpose.label}</span>
                    <span
                      className={
                        purpose.active
                          ? "inline-flex items-center gap-1.5 rounded-pill bg-positive-soft px-2.5 py-0.5 text-xs font-medium text-positive"
                          : "inline-flex items-center gap-1.5 rounded-pill bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-ink-muted"
                      }
                    >
                      <span
                        aria-hidden="true"
                        className={
                          purpose.active
                            ? "size-1.5 rounded-pill bg-positive"
                            : "size-1.5 rounded-pill bg-ink-subtle"
                        }
                      />
                      {purpose.active ? "Ativo" : "Não ativo"}
                      {purpose.documentVersion
                        ? ` · versão ${purpose.documentVersion}`
                        : ""}
                    </span>
                  </div>

                  {/*
                    Linha do tempo: cada evento com estado, data e versao, em
                    ordem. Nada e apagado — a revogacao e um no novo, e a
                    concessao anterior continua visivel.
                  */}
                  <ol className="mt-3 flex flex-col">
                    {purpose.events.map((event, index) => (
                      <li
                        key={event.id}
                        className="relative flex gap-3 pb-2 last:pb-0"
                      >
                        <span aria-hidden="true" className="relative flex w-3 shrink-0 justify-center">
                          <span
                            className={
                              event.eventType === "granted"
                                ? "mt-1 size-2.5 rounded-pill border-2 border-surface bg-positive ring-1 ring-positive/40"
                                : "mt-1 size-2.5 rounded-pill border-2 border-surface bg-ink-subtle ring-1 ring-line-strong"
                            }
                          />
                          {index < purpose.events.length - 1 ? (
                            <span className="absolute bottom-0 top-3.5 w-px bg-line-strong" />
                          ) : null}
                        </span>
                        <span className="text-xs leading-5 text-ink-muted">
                          {event.eventType === "granted" ? "Concedido" : "Revogado"}{" "}
                          em {formatarData(event.occurredAt)}
                          {event.eventType === "granted"
                            ? ` · documento ${event.documentVersion}`
                            : ""}
                        </span>
                      </li>
                    ))}
                  </ol>

                  {purpose.description ? (
                    <Disclosure summary="O que esta autorização permite" className="mt-2">
                      {purpose.description}
                    </Disclosure>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {/*
            O que nao e evento precisa ser dito. Uma linha do tempo que mostra
            quatro finalidades e cala sobre as demais sugere que as demais nao
            existem.
          */}
          <div
            data-testid="consent-elsewhere"
            className="rounded-control bg-surface-muted p-3"
          >
            <p className="text-sm font-medium text-ink">
              Autorizações que não vivem nesta linha do tempo
            </p>
            <ul className="mt-2 flex flex-col gap-3">
              {consents.elsewhere.map((item) => (
                <li key={item.id} className="text-sm text-ink-muted">
                  <span className="block font-medium text-ink">{item.label}</span>
                  <span className="block text-ink-subtle">{item.whereToChange}</span>
                  <Disclosure summary="Por que fica em outro lugar">
                    {item.description}
                  </Disclosure>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
