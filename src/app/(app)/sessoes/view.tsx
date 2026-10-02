"use client";

import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  ChevronRight,
  FileText,
  Heart,
  MessageCircle,
  Mic,
  Monitor,
  Save,
  ScanFace,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type * as React from "react";

import { PageHeader } from "@/components/journey/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IconPill } from "@/components/ui/icon-pill";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  hasAnyCapture,
  SESSION_KINDS,
  SESSION_KIND_DESCRIPTION,
  SESSION_KIND_DURATION,
  SESSION_KIND_LABEL,
  SESSION_STATUS_LABEL,
  type CaptureResource,
  type CaptureStateMap,
  type MultimodalSession,
  type MultimodalSessionDetail,
  type SessionKind,
  type SessionSetup,
} from "@/lib/contracts/session";
import {
  canStartSession,
  detectCaptureCapabilities,
  initialCaptureStates,
} from "@/lib/multimodal-capture";
import {
  installLocalSpeech,
  probeLocalSpeechAvailability,
  type LocalSpeechAvailability,
} from "@/lib/multimodal-derivation";
import { cn } from "@/lib/utils";
import { useMockStore } from "@/mocks/store";
import { TranscriptionPreflight, useSpeechPreparation } from "@/components/transcription-preflight";
import { speechPreparation, transcriptionCanStart } from "@/lib/speech/preparation";
import { InlineSpinner } from "@/components/states";



const KIND_ICON: Record<SessionKind, typeof Heart> = {
  guided: Sparkles,
  free: MessageCircle,
  deep_checkin: Heart,
};

const KIND_TONE: Record<SessionKind, "brand" | "sleep" | "energy"> = {
  guided: "brand",
  free: "sleep",
  deep_checkin: "energy",
};

const RESOURCE_ICON: Record<CaptureResource, typeof Monitor> = {
  screen: Monitor,
  camera: Camera,
  microphone: Mic,
};

const RESOURCE_LABEL: Record<CaptureResource, string> = {
  screen: "Tela",
  camera: "Câmera",
  microphone: "Microfone",
};

interface ToggleRow {
  field: keyof Omit<SessionSetup, "kind">;
  icon: typeof Monitor;
  label: string;
  description: string;
}

const CAPTURE_TOGGLES: ToggleRow[] = [
  {
    field: "screen",
    icon: Monitor,
    label: "Gravar/compartilhar tela",
    description: "Permite capturar sua tela durante a sessão.",
  },
  {
    field: "camera",
    icon: Camera,
    label: "Usar câmera",
    description: "Permite que a Elyra veja você durante a sessão.",
  },
  {
    field: "microphone",
    icon: Mic,
    label: "Usar microfone",
    description: "Permite que a Elyra ouça você durante a sessão.",
  },
  {
    field: "transcribe",
    icon: FileText,
    label: "Gerar transcrição",
    description: "Converte o áudio da sessão em texto.",
  },
  {
    field: "visualAnalysis",
    icon: ScanFace,
    /*
      O rotulo e a descricao carregam a distincao inteira.

      "Usar camera" e "analisar sinais visuais" sao decisoes diferentes, e a
      unica coisa que impede a segunda de parecer consequencia da primeira e o
      texto dizer o que ela faz: mede movimento, no aparelho, sem enviar imagem,
      e **nao** le emocao. Sem essa frase, ligar a camera viraria consentimento
      presumido para observacao corporal.
    */
    label: "Analisar sinais visuais",
    description:
      "Mede movimento de cabeça, corpo e mãos no seu aparelho. Não identifica emoção e não envia imagem.",
  },
  {
    field: "keepRecording",
    icon: Save,
    label: "Guardar gravação após análise",
    description: "Mantém a gravação disponível depois do processamento.",
  },
  {
    field: "aiAnalysis",
    icon: Sparkles,
    label: "Autorizar análise por IA",
    description: "Consentimento separado e independente dos demais.",
  },
];

const SHARING_TOGGLES: ToggleRow[] = [
  {
    field: "shareResult",
    icon: Users,
    label: "Compartilhar resultado com profissional",
    description: "Permite que seu profissional veja sua análise.",
  },
  {
    field: "shareTranscript",
    icon: FileText,
    label: "Compartilhar transcrição com profissional",
    description: "Disponibiliza o texto da sessão. Decisão separada do resultado.",
  },
  {
    field: "shareRecording",
    icon: ShieldCheck,
    label: "Compartilhar gravação original com profissional",
    description: "Disponibiliza a mídia bruta. Decisão separada da transcrição.",
  },
];


const STEP_GROUPS: Array<{
  step: number;
  title: string;
  hint: string;
  fields: ToggleRow["field"][];
}> = [
  {
    step: 2,
    title: "Recursos de captura",
    hint: "Tela, câmera e microfone são permissões independentes.",
    fields: ["screen", "camera", "microphone"],
  },
  {
    step: 3,
    title: "Processamento",
    hint: "O que é derivado da captura — cada item exige o recurso de origem.",
    fields: ["transcribe", "visualAnalysis", "aiAnalysis"],
  },
  {
    step: 4,
    title: "Retenção",
    hint: "Por padrão, a gravação não é guardada depois da análise.",
    fields: ["keepRecording"],
  },
];

/**
 * Cabecalho do modulo. Em `/sessoes` (ADR-0029) o modulo e uma secao da
 * entrada unificada: o titulo desce para h2 (a pagina tem um unico h1).
 */
function ModuleHeader({
  embedded,
  title,
  description,
  badge,
}: {
  embedded: boolean;
  title: string;
  description: string;
  badge: React.ReactNode;
}) {
  if (!embedded) return <PageHeader title={title} description={description} meta={badge} />;
  return (
    <div className="mb-5 flex flex-col gap-1.5 lg:mb-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold tracking-tight text-ink">{title}</h2>
        {badge}
      </div>
      <p className="max-w-prose text-sm text-ink-muted">{description}</p>
    </div>
  );
}

export function SessionsView({ embedded = false }: { embedded?: boolean } = {}) {
  const {
    sessionsEnabled,
    setSessionsEnabled,
    sessionSetup,
    updateSessionSetup,
    resetSessionSetup,
  } = useMockStore();
  const router = useRouter();
  const [captureStates, setCaptureStates] = useState<CaptureStateMap>({
    screen: "unsupported",
    camera: "unsupported",
    microphone: "unsupported",
  });
  const [startBusy, setStartBusy] = useState(false);
  /** Resposta crua da sonda de reconhecimento local. `null` = ainda nao sondada. */
  const [localSpeech, setLocalSpeech] = useState<LocalSpeechAvailability | null>(
    null,
  );
  const [installingSpeech, setInstallingSpeech] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<MultimodalSession[]>([]);
  const preparation = useSpeechPreparation();

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setCaptureStates(initialCaptureStates(detectCaptureCapabilities()));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!sessionsEnabled) return;
    let active = true;
    void fetch("/api/multimodal/sessions")
      .then(async (response) => {
        const payload = (await response.json()) as {
          data?: MultimodalSession[];
        };
        if (active && response.ok && payload.data) setSessions(payload.data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [sessionsEnabled]);

  /*
    Sonda de reconhecimento local, no **preflight**.

    A validacao fisica descobriu que a transcricao nao aconteceria so depois de
    tres minutos falando. Perguntar antes muda a decisao: da para ligar o
    microfone sabendo que so os sinais de audio virao, ou instalar o idioma e
    tentar de novo.

    O estado real e mostrado sem colapsar - `downloadable` e acionavel e
    `unavailable` nao, e fundir os dois esconderia a acao.
  */
  useEffect(() => {
    if (!sessionSetup.transcribe) return;
    let active = true;
    void probeLocalSpeechAvailability().then((answer) => {
      if (active) setLocalSpeech(answer);
    });
    return () => {
      active = false;
    };
  }, [sessionSetup.transcribe]);

  if (!sessionsEnabled) {
    return <SessionsGate embedded={embedded} onEnable={() => setSessionsEnabled(true)} />;
  }

  const captureAuthorized = hasAnyCapture(sessionSetup);
  /*
   * A regra vive em `multimodal-capture`, nao aqui.
   *
   * `SCREEN_UNSUPPORTED` nao pode tornar a sessao indisponivel: o Safari do
   * iPhone nao expoe `getDisplayMedia`, mas expoe camera e microfone, e uma
   * sessao com camera e microfone e uma sessao legitima. Como invariante de
   * produto, isso precisa de teste proprio - dentro de uma expressao de render
   * voltaria a quebrar sem ninguem perceber.
   */
  const supportedCaptureAuthorized = canStartSession(
    sessionSetup,
    captureStates,
  );


  async function installSpeechPack() {
    setInstallingSpeech(true);
    try {
      const outcome = await installLocalSpeech();
      // Instalacao bem-sucedida nao e prova de que o reconhecimento sera local:
      // quem prova e a sonda, e `installLocalSpeech` ja a roda de novo.
      setLocalSpeech(
        outcome.status === "installed"
          ? outcome.availability
          : await probeLocalSpeechAvailability(),
      );
    } finally {
      setInstallingSpeech(false);
    }
  }

  async function startSession(setup = sessionSetup) {
    setStartBusy(true);
    setStartError(null);
    try {
      const native = setup.transcribe ? await probeLocalSpeechAvailability() : null;
      setLocalSpeech(native);
      if (!canStartSession(setup, captureStates) ||
          !transcriptionCanStart(setup.transcribe, native, speechPreparation.getSnapshot())) {
        throw new Error("A transcrição ainda não está pronta. Prepare ou escolha continuar sem transcrição.");
      }
      const response = await fetch("/api/multimodal/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(setup),
      });
      const payload = (await response.json()) as {
        data?: MultimodalSessionDetail;
        error?: string;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Não foi possível iniciar a sessão.");
      }
      /*
        Consentimento nao se herda.

        A sessao criada guarda no servidor exatamente o que foi autorizado para
        ela - isso nao muda. O que se reseta e a **preparacao da proxima**: sem
        este passo, o estado sobrevivia a navegacao dentro da SPA e a sessao
        seguinte nascia com camera, gravacao e tela ja marcadas, sem ninguem ter
        decidido de novo.

        Foi assim que a validacao fisica gravou tela e midia numa sessao que
        pretendia nao gravar nada.
      */
      resetSessionSetup();
      router.push(`/sessoes/nova?id=${payload.data.id}`);
    } catch (error) {
      setStartError(
        error instanceof Error ? error.message : "Não foi possível iniciar a sessão.",
      );
    } finally {
      setStartBusy(false);
    }
  }

  return (
    <>
      <ModuleHeader
        embedded={embedded}
        title="Sessões multimodais"
        description="Combine diferentes recursos para sessões mais completas e personalizadas. Escolha o tipo de sessão ideal para o seu momento."
        badge={<Badge tone="brand">BETA</Badge>}
      />

      {/*
        QA humano do owner (27/09): a grade xl de duas colunas espremia TODAS as
        permissoes numa coluna lateral de ~330px (e deixava um vazio enorme a
        esquerda) e a tabela de historico (min 640px) rolava na horizontal em
        1280-1366px. Uma coluna na ordem do fluxo: tipo -> preparar -> historico;
        a largura vai para dentro do "Preparar sessao" (grupos em 2 colunas).
      */}
      <div className="grid gap-5">
        <div className="contents">
          <fieldset className="order-1">
            <legend className="mb-3 text-base font-semibold text-ink lg:text-lg">
              1. Escolha o tipo de sessão
            </legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {SESSION_KINDS.map((kind) => {
                const Icon = KIND_ICON[kind];
                const selected = sessionSetup.kind === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => updateSessionSetup({ kind })}
                    className={cn(
                      "group relative flex h-full items-start gap-3 rounded-card border p-4 text-left shadow-card transition-[border-color,box-shadow,background-color] duration-200 sm:flex-col sm:p-5",
                      selected
                        ? "border-brand-400 bg-brand-50 ring-2 ring-brand-200"
                        : "border-line bg-surface hover:border-brand-200 hover:shadow-raised",
                    )}
                  >
                    {selected ? (
                      <CheckCircle2
                        className="absolute right-3 top-3 size-5 text-brand-600"
                        aria-hidden="true"
                      />
                    ) : null}
                    <IconPill tone={KIND_TONE[kind]} size="lg">
                      <Icon />
                    </IconPill>
                    <div className="min-w-0 pr-6 sm:pr-0">
                      <h2 className="font-semibold text-ink">
                        {SESSION_KIND_LABEL[kind]}
                      </h2>
                      <p className="mt-1 text-sm text-ink-muted">
                        {SESSION_KIND_DESCRIPTION[kind]}
                      </p>
                    </div>
                    <span className="mt-auto hidden items-center gap-1 pt-2 text-xs font-medium text-ink-subtle sm:inline-flex">
                      {SESSION_KIND_DURATION[kind]}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* Abaixo de xl o historico vem depois do preparo: quem abre a tela para comecar nao precisa atravessar as sessoes antigas. */}
          <Card className="order-3">
            <CardContent>
              <h2 className="mb-4 text-base font-semibold text-ink lg:text-lg">
                Suas sessões anteriores
              </h2>

              {/*
                No celular, a tabela de seis colunas vira lista: mesma informacao,
                sem rolagem lateral. A tabela continua a partir de `md`.
              */}
              {/*
                A regiao nomeada envolve lista (celular) e tabela (md+), e existe
                em qualquer largura: e o marco que a jornada de sessoes usa.
              */}
              <div role="region" aria-label="Tabela de sessões anteriores">
              {/*
                O estado vazio mora DENTRO da regiao: sem ele, com zero sessoes a
                regiao ficava com altura zero no celular (lista vazia e tabela
                oculta abaixo de md) e deixava de ser um marco visivel.
              */}
              {sessions.length === 0 ? (
                <p className="rounded-control bg-surface-muted px-4 py-6 text-center text-sm text-ink-muted">
                  Suas sessões aparecem aqui depois da primeira. Nada é gravado
                  sem que você autorize recurso por recurso.
                </p>
              ) : null}
              <ul className="flex flex-col divide-y divide-line md:hidden">
                {sessions.map((session) => {
                  const when = new Date(session.startedAt);
                  const Icon = KIND_ICON[session.kind];
                  return (
                    <li key={session.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <IconPill tone={KIND_TONE[session.kind]} size="sm">
                        <Icon />
                      </IconPill>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">
                          {SESSION_KIND_LABEL[session.kind]}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                          <span>
                            {when.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}{" "}
                            {when.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {session.durationMinutes === null
                              ? "Sem registro"
                              : `${session.durationMinutes} min`}
                          </span>
                          <Badge tone={session.status === "error" ? "attention" : "positive"}>
                            {SESSION_STATUS_LABEL[session.status]}
                          </Badge>
                        </p>
                      </div>
                      <Button asChild variant="secondary" size="sm">
                        <Link href={`/sessoes/${session.id}`}>
                          {session.status === "analyzed" ? "Ver análise" : "Ver captura"}
                        </Link>
                      </Button>
                    </li>
                  );
                })}
              </ul>

              <div
                className="hidden overflow-x-auto md:block"
                tabIndex={0}
              >
                <table className="w-full min-w-[640px] text-sm">
                  <caption className="sr-only">
                    Sessões multimodais realizadas
                  </caption>
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-subtle">
                      <th scope="col" className="py-3 font-medium">Data</th>
                      <th scope="col" className="py-3 font-medium">Tipo de sessão</th>
                      <th scope="col" className="whitespace-nowrap py-3 font-medium">Recursos</th>
                      <th scope="col" className="py-3 font-medium">Duração</th>
                      <th scope="col" className="py-3 font-medium">Status</th>
                      <th scope="col" className="py-3 text-right font-medium">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((session) => {
                      const when = new Date(session.startedAt);
                      const Icon = KIND_ICON[session.kind];
                      return (
                        <tr
                          key={session.id}
                          className="border-b border-line transition-colors last:border-0 hover:bg-surface-muted/60"
                        >
                          <td className="whitespace-nowrap py-3.5 pr-4">
                            <span className="font-medium text-ink">
                              {when.toLocaleDateString("pt-BR", {
                                day: "2-digit",
                                month: "short",
                              })}
                            </span>
                            <span className="ml-2 text-ink-subtle">
                              {when.toLocaleTimeString("pt-BR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </td>
                          <td className="py-3.5 pr-4">
                            <span className="flex items-center gap-2 whitespace-nowrap text-ink">
                              <IconPill tone={KIND_TONE[session.kind]} size="sm">
                                <Icon />
                              </IconPill>
                              {SESSION_KIND_LABEL[session.kind]}
                            </span>
                          </td>
                          <td className="py-3.5 pr-4">
                            <span className="flex items-center gap-1.5">
                              {session.resources.map((r) => {
                                const RIcon = RESOURCE_ICON[r];
                                return (
                                  <span
                                    key={r}
                                    title={RESOURCE_LABEL[r]}
                                    className="flex size-7 items-center justify-center rounded-control bg-surface-brand text-brand-600"
                                  >
                                    <RIcon className="size-3.5" aria-hidden="true" />
                                    <span className="sr-only">
                                      {RESOURCE_LABEL[r]}
                                    </span>
                                  </span>
                                );
                              })}
                            </span>
                          </td>
                          <td className="py-4 pr-4 text-ink-muted">
                            {session.durationMinutes === null
                              ? "Sem registro"
                              : `${session.durationMinutes} min`}
                          </td>
                          <td className="whitespace-nowrap py-3.5 pr-4">
                            <Badge tone={session.status === "error" ? "attention" : "positive"}>
                              <CheckCircle2 className="size-3" aria-hidden="true" />
                              {SESSION_STATUS_LABEL[session.status]}
                            </Badge>
                          </td>
                          <td className="py-3.5 text-right">
                            <Button asChild variant="secondary" size="sm">
                              <Link href={`/sessoes/${session.id}`}>
                                {session.status === "analyzed" ? "Ver análise" : "Ver captura"}
                                <ChevronRight aria-hidden="true" />
                              </Link>
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="order-2 flex min-w-0 flex-col gap-5">
          <Card>
            <CardContent>
              <div className="mb-1 flex items-center gap-2">
                <h2 className="text-base font-semibold text-ink lg:text-lg">
                  Preparar sessão
                </h2>
                <Badge tone="brand">BETA</Badge>
              </div>
              <p className="mb-4 text-sm text-ink-muted">
                Cada permissão é independente e{" "}
                <strong className="font-medium text-ink">
                  todas começam desligadas
                </strong>
                . Habilitar o módulo nas configurações não autoriza tela, câmera
                nem microfone.
              </p>

              <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2" data-testid="session-permission-groups">
              {STEP_GROUPS.map((group) => (
                <section key={group.title} aria-label={group.title} className="min-w-0">
                  <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
                    <span className="inline-flex size-6 items-center justify-center rounded-pill bg-brand-100 text-xs font-semibold text-brand-700">
                      {group.step}
                    </span>
                    {group.title}
                  </h3>
                  <p className="mb-2 pl-8 text-xs text-ink-subtle">{group.hint}</p>
              <div className="flex flex-col divide-y divide-line rounded-control border border-line px-3">
                {CAPTURE_TOGGLES.filter((row) => group.fields.includes(row.field)).map((row) => (
                  <ToggleLine
                    key={row.field}
                    row={row}
                    checked={sessionSetup[row.field]}
                    onChange={(value) => {
                      if (row.field === "microphone" && !value) {
                        updateSessionSetup({
                          microphone: false,
                          transcribe: false,
                          shareTranscript: false,
                        });
                      } else if (row.field === "camera" && !value) {
                        // Desligar a camera desliga a analise visual junto: ela
                        // nao tem do que ser derivada, e deixa-la marcada
                        // sugeriria que algo continua sendo observado.
                        updateSessionSetup({
                          camera: false,
                          visualAnalysis: false,
                        });
                      } else if (row.field === "keepRecording" && !value) {
                        updateSessionSetup({
                          keepRecording: false,
                          shareRecording: false,
                        });
                      } else {
                        updateSessionSetup({ [row.field]: value });
                      }
                    }}
                    disabled={
                      ((row.field === "screen" ||
                          row.field === "camera" ||
                          row.field === "microphone") &&
                        captureStates[row.field] === "unsupported") ||
                      (row.field === "transcribe" && !sessionSetup.microphone) ||
                      (row.field === "visualAnalysis" && !sessionSetup.camera)
                    }
                    extra={
                      row.field === "transcribe" &&
                      sessionSetup.transcribe ? (
                        <div
                          className="mt-3 rounded-control bg-attention-soft p-3 text-xs text-ink"
                          data-testid="local-speech-preflight"
                          data-state={localSpeech}
                        >
                          <TranscriptionPreflight native={localSpeech} preparation={preparation}
                            onWithout={() => {
                              speechPreparation.cancel();
                              const setup = { ...sessionSetup, transcribe: false, shareTranscript: false };
                              updateSessionSetup(setup);
                              void startSession(setup);
                            }} />
                          {/*
                            Instalacao **so** quando ha o que instalar, e so por
                            acao explicita: `install()` baixa dezenas de MB e
                            escreve no aparelho de alguem.
                          */}
                          {localSpeech === "downloadable" ? (
                            <Button
                              className="mt-2 h-auto min-h-11 max-w-full whitespace-normal py-2 text-center lg:min-h-9"
                              variant="secondary"
                              size="sm"
                              disabled={installingSpeech}
                              onClick={() => void installSpeechPack()}
                            >
                              {installingSpeech
                                ? "Baixando…"
                                : "Baixar reconhecimento em português"}
                            </Button>
                          ) : null}
                        </div>
                      ) : row.field === "screen" && sessionSetup.screen ? (
                        <p
                          role="note"
                          className="mt-3 flex items-start gap-2 rounded-control bg-attention-soft p-3 text-xs text-ink"
                        >
                          <AlertTriangle
                            className="mt-0.5 size-4 shrink-0 text-attention"
                            aria-hidden="true"
                          />
                          A captura de tela pode incluir notificações, mensagens
                          ou informações sensíveis. Recomendamos fechar
                          aplicativos privados.
                        </p>
                      ) : null
                    }
                  />
                ))}
              </div>
                </section>
              ))}

              <section aria-label="Compartilhamento com profissional" className="min-w-0">
              <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
                <span className="inline-flex size-6 items-center justify-center rounded-pill bg-brand-100 text-xs font-semibold text-brand-700">
                  5
                </span>
                Compartilhamento com profissional
              </h3>
              <p className="mb-2 pl-8 text-xs text-ink-subtle">
                Resultado, transcrição e gravação são decisões separadas.
              </p>

              <div className="flex flex-col divide-y divide-line rounded-control border border-line px-3">
                {SHARING_TOGGLES.map((row) => (
                  <ToggleLine
                    key={row.field}
                    row={row}
                    checked={sessionSetup[row.field]}
                    onChange={(v) => updateSessionSetup({ [row.field]: v })}
                    disabled={
                      (row.field === "shareTranscript" && !sessionSetup.transcribe) ||
                      (row.field === "shareRecording" && !sessionSetup.keepRecording)
                    }
                  />
                ))}
              </div>
              </section>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-start">
          <Card>
            <CardContent>
              <h2 className="text-base font-semibold text-ink">
                Verificação de dispositivos
              </h2>
              <p className="mb-4 mt-0.5 text-sm text-ink-muted">
                Confira se seus dispositivos estão prontos antes de começar.
              </p>

              <ul className="flex flex-col divide-y divide-line">
                {[
                  { resource: "camera" as const, icon: Camera, label: "Câmera" },
                  { resource: "microphone" as const, icon: Mic, label: "Microfone" },
                  { resource: "screen" as const, icon: Monitor, label: "Compartilhamento de tela" },
                ].map(({ resource, icon: Icon, label }) => (
                  <li
                    key={label}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="flex items-center gap-3 text-sm text-ink">
                      <IconPill tone="neutral" size="sm">
                        <Icon />
                      </IconPill>
                      {label}
                    </span>
                    <span
                      data-testid={`capability-${resource}`}
                      className={cn(
                        "flex items-center gap-1.5 text-sm",
                        captureStates[resource] === "unsupported"
                          ? "text-ink-subtle"
                          : "text-positive",
                      )}
                    >
                      {captureStates[resource] === "unsupported"
                        ? "Não suportado neste navegador"
                        : "Suportado"}
                      {captureStates[resource] !== "unsupported" ? (
                        <CheckCircle2 className="size-4" aria-hidden="true" />
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="mt-4 text-xs text-ink-subtle">
                A verificação usa as APIs presentes neste navegador. A permissão
                só será solicitada na próxima tela, por ação explícita.
              </p>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              disabled={!captureAuthorized || !supportedCaptureAuthorized || startBusy ||
                !transcriptionCanStart(sessionSetup.transcribe, localSpeech, preparation)}
              onClick={() => void startSession()}
            >
              {startBusy ? <InlineSpinner /> : null}
              {startBusy ? "Preparando sessão" : "Iniciar sessão"}
              <ArrowRight aria-hidden="true" />
            </Button>
            {!captureAuthorized ? (
              <p
                data-testid="capture-required"
                className="text-center text-sm text-ink-muted"
              >
                Autorize ao menos um recurso de captura acima para iniciar. Nada
                é ligado automaticamente.
              </p>
            ) : null}
            {captureAuthorized && !supportedCaptureAuthorized ? (
              <p className="text-center text-sm text-attention">
                Nenhum recurso autorizado é suportado neste navegador.
              </p>
            ) : null}
            {startError ? (
              <p role="alert" className="text-center text-sm text-destructive">
                {startError}
              </p>
            ) : null}
          </div>
          </div>
        </div>
      </div>
    </>
  );
}

function ToggleLine({
  row,
  checked,
  onChange,
  extra,
  disabled = false,
}: {
  row: ToggleRow;
  checked: boolean;
  onChange: (value: boolean) => void;
  extra?: React.ReactNode;
  disabled?: boolean;
}) {
  const Icon = row.icon;
  const id = `session-${row.field}`;

  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <IconPill tone="neutral" size="sm">
            <Icon />
          </IconPill>
          <div className="min-w-0">
            <Label htmlFor={id}>{row.label}</Label>
            <p className="mt-0.5 text-sm text-ink-muted">{row.description}</p>
          </div>
        </div>
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
        />
      </div>
      {extra}
    </div>
  );
}

/**
 * Portao do modulo de sessoes.
 *
 * Ativar o modulo e uma decisao; autorizar captura de tela, camera ou microfone
 * sao outras tres, tomadas no preflight. Este portao existe para que as duas
 * coisas nunca aconteçam no mesmo clique.
 */
function SessionsGate({ onEnable, embedded }: { onEnable: () => Promise<void>; embedded: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <ModuleHeader
        embedded={embedded}
        title="Sessões multimodais"
        description="Um espaço para falar sobre o seu dia usando os recursos que você escolher."
        badge={<Badge tone="brand">BETA</Badge>}
      />

      {/*
        QA do owner (27/09): o card tinha `max-w-3xl` e deixava a faixa direita
        vazia, desalinhado da grade de Sessoes acima. Na largura da grade, com
        duas colunas no desktop: decisao a esquerda, o que ela implica a direita.
      */}
      <Card>
        <CardContent className="grid gap-5 lg:grid-cols-2 lg:gap-8">
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-lg font-semibold text-ink">
                Ativar as sessões multimodais
              </h2>
              <p className="mt-2 text-ink-muted">
                Ao ativar, a área de sessões passa a existir para você. Nenhuma
                permissão de captura é concedida agora: tela, câmera e microfone
                são autorizados um a um, sempre que você preparar uma sessão.
              </p>
            </div>
            <div>
              <Button
                size="lg"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  void onEnable()
                    .catch((caught) => {
                      setError(
                        caught instanceof Error
                          ? caught.message
                          : "Não foi possível ativar as sessões.",
                      );
                    })
                    .finally(() => setBusy(false));
                }}
              >
                {busy ? <InlineSpinner /> : null}
                {busy ? "Ativando" : "Ativar sessões multimodais"}
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>

            {error ? (
              <p role="alert" className="text-sm text-destructive">{error}</p>
            ) : null}

            <p className="text-sm text-ink-subtle">
              Você pode desativar a qualquer momento em Configurações. Desativar
              revoga as permissões de captura já escolhidas.
            </p>
          </div>

          <ul className="flex flex-col gap-3 lg:self-center">
            {[
              {
                icon: Monitor,
                text: "Tela, câmera e microfone começam desligados e são decididos por sessão.",
              },
              {
                icon: FileText,
                text: "Transcrição é um recurso separado e também começa desligado.",
              },
              {
                icon: ShieldCheck,
                text: "Compartilhar resultado, transcrição ou gravação com um profissional são três decisões distintas.",
              },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <IconPill tone="neutral" size="sm">
                  <Icon />
                </IconPill>
                <span className="text-sm text-ink-muted">{text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
