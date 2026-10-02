"use client";

import { useState } from "react";

import { Disclosure } from "@/components/ui/disclosure";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  NOTIFICATION_CHANNEL_LABEL,
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_DESCRIPTION,
  NOTIFICATION_KIND_LABEL,
  SNOOZE_OPTIONS,
  isSnoozed,
  notificationPreferencesSchema,
  type NotificationChannel,
  type NotificationKind,
  type NotificationPreferences,
} from "@/lib/contracts/notifications";

/**
 * Preferencia de notificacao: a matriz canal x tipo.
 *
 * ## Por que uma matriz, e nao uma lista de interruptores
 *
 * A pergunta que a pessoa faz nao e "quero notificacao?", e sim "quero *este
 * aviso* *por este caminho*?". Com um interruptor por tipo, quem quer o
 * lembrete na tela mas nao no celular precisa escolher entre os dois — e a
 * escolha que sobra costuma ser desligar tudo.
 *
 * ## Por que o estado inicial vem do servidor
 *
 * Igual ao sino de notificacoes: a pagina ja e um server component autenticado,
 * entao ela busca a matriz e entrega pronta. Buscar no cliente exigiria
 * `setState` dentro de efeito — o que a regra de hooks deste repositorio recusa,
 * e com razao: produziria render em cascata e um piscar de "carregando" numa
 * tela que ja tinha o dado disponivel antes de renderizar.
 *
 * A rede so e tocada quando **a pessoa muda alguma coisa**.
 *
 * ## Nomes acessiveis
 *
 * O switch de `in_app` mantem **exatamente** o rotulo do tipo ("Lembrete de
 * check-in"), porque e assim que ele e encontrado por quem usa leitor de tela e
 * pelo E2E de persistencia de identidade. Os demais canais qualificam o nome,
 * para que dois controles nunca disputem a mesma descricao.
 */

export function NotificationPreferencesCard({
  initialPreferences,
  initiallyUnavailable = false,
}: {
  initialPreferences: NotificationPreferences;
  initiallyUnavailable?: boolean;
}) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [error, setError] = useState<string | null>(
    initiallyUnavailable
      ? "Não foi possível carregar suas preferências de notificação."
      : null,
  );
  const [saving, setSaving] = useState<string | null>(null);

  async function patch(
    kind: NotificationKind,
    channel: NotificationChannel,
    body: { enabled?: boolean; snoozedUntil?: string | null },
  ) {
    setSaving(`${kind}:${channel}`);
    setError(null);
    try {
      const response = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ kind, channel, ...body }),
      });
      if (!response.ok) throw new Error("save_failed");
      const payload = (await response.json()) as { data?: unknown };
      setPreferences(notificationPreferencesSchema.parse(payload.data));
    } catch {
      setError("Não foi possível salvar a preferência.");
    } finally {
      setSaving(null);
    }
  }

  const find = (kind: NotificationKind, channel: NotificationChannel) =>
    preferences.preferences.find(
      (item) => item.kind === kind && item.channel === channel,
    ) ?? null;

  const channels = preferences.availableChannels;
  /*
    So afirmamos indisponibilidade quando houve leitura. Com erro na tela, o
    que existe e ausencia de informacao — e dizer "o canal nao esta disponivel"
    seria transformar falha de rede em fato sobre a instalacao.
  */
  const pushUnavailable = error === null && !channels.includes("web_push");
  const emailUnavailable = error === null && !channels.includes("email");

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Preferências</CardTitle>
        <CardDescription>
          Escolha o que você quer receber e por onde. Não receber nada também é
          uma escolha válida.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-line">
        {error ? (
          <p role="alert" className="pb-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {NOTIFICATION_KINDS.map((kind) => {
          const inApp = find(kind, "in_app");
          const snoozed = inApp ? isSnoozed(inApp) : false;
          // Adiar e do tipo (vale para todos os canais); aparece se algum
          // canal entregavel do tipo esta ligado.
          const anyEnabled =
            Boolean(inApp?.enabled) ||
            (channels.includes("email") && Boolean(find(kind, "email")?.enabled));
          return (
            <div key={kind} className="py-4 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <Label htmlFor={`notif-${kind}-in_app`}>
                    {NOTIFICATION_KIND_LABEL[kind]}
                  </Label>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    {NOTIFICATION_KIND_DESCRIPTION[kind]}
                  </p>
                </div>
                <Switch
                  id={`notif-${kind}-in_app`}
                  checked={inApp?.enabled ?? false}
                  disabled={saving === `${kind}:in_app`}
                  onCheckedChange={(checked) =>
                    void patch(kind, "in_app", { enabled: checked })
                  }
                />
              </div>

              {channels.includes("web_push") ? (
                <div className="mt-3 flex items-center justify-between gap-6 pl-1">
                  <Label
                    htmlFor={`notif-${kind}-web_push`}
                    className="text-sm text-ink-muted"
                  >
                    {`${NOTIFICATION_KIND_LABEL[kind]} — ${NOTIFICATION_CHANNEL_LABEL.web_push}`}
                  </Label>
                  <Switch
                    id={`notif-${kind}-web_push`}
                    checked={find(kind, "web_push")?.enabled ?? false}
                    disabled={saving === `${kind}:web_push`}
                    onCheckedChange={(checked) =>
                      void patch(kind, "web_push", { enabled: checked })
                    }
                  />
                </div>
              ) : null}

              {channels.includes("email") ? (
                <div className="mt-3 flex items-center justify-between gap-6 pl-1">
                  <Label
                    htmlFor={`notif-${kind}-email`}
                    className="text-sm text-ink-muted"
                  >
                    {`${NOTIFICATION_KIND_LABEL[kind]} — ${NOTIFICATION_CHANNEL_LABEL.email}`}
                  </Label>
                  <Switch
                    id={`notif-${kind}-email`}
                    checked={find(kind, "email")?.enabled ?? false}
                    disabled={saving === `${kind}:email`}
                    onCheckedChange={(checked) =>
                      void patch(kind, "email", { enabled: checked })
                    }
                  />
                </div>
              ) : null}

              {/*
                Adiar so aparece para o que esta ligado: oferecer adiamento de
                um aviso desligado seria oferecer silencio sobre silencio.
              */}
              {anyEnabled ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 pl-1">
                  <span className="text-xs text-ink-subtle">
                    {snoozed
                      ? `Adiado até ${new Date(inApp?.snoozedUntil ?? "").toLocaleDateString("pt-BR")}`
                      : "Adiar"}
                  </span>
                  {SNOOZE_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      disabled={saving === `${kind}:in_app`}
                      onClick={() => {
                        const until = new Date();
                        until.setDate(until.getDate() + option.days);
                        void patch(kind, "in_app", {
                          snoozedUntil: until.toISOString(),
                        });
                      }}
                      className="inline-flex min-h-11 items-center rounded-control border border-line px-3 text-xs text-ink hover:bg-surface-muted disabled:opacity-60 lg:min-h-8"
                    >
                      {option.label}
                    </button>
                  ))}
                  {snoozed ? (
                    <button
                      type="button"
                      disabled={saving === `${kind}:in_app`}
                      onClick={() =>
                        void patch(kind, "in_app", { snoozedUntil: null })
                      }
                      className="inline-flex min-h-11 items-center rounded-control px-3 text-xs font-medium text-brand-700 hover:bg-surface-muted disabled:opacity-60 lg:min-h-8"
                    >
                      Voltar a receber
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}

        {pushUnavailable || emailUnavailable ? (
          <div className="pt-3">
            <Disclosure summary="Outros canais">
              {pushUnavailable ? (
                <p className="text-xs text-ink-subtle">
                  A notificação do navegador não está disponível nesta instalação.
                  Quando estiver, ela aparece aqui como uma opção separada — e
                  continua dependendo da sua autorização no navegador.
                </p>
              ) : null}
              {emailUnavailable ? (
                <p className="mt-2 text-xs text-ink-subtle">
                  O e-mail não está disponível nesta instalação. Quando estiver,
                  ele aparece aqui como uma opção separada, desligada — e nenhum
                  e-mail de lembrete é enviado sem você ligar.
                </p>
              ) : null}
            </Disclosure>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
