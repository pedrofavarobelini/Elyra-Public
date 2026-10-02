import {
  BatteryCharging,
  Bed,
  Brain,
  Flower2,
  Moon,
  Sparkles,
} from "lucide-react";
import type { Metadata } from "next";

import { ChartCard } from "@/components/charts/chart-card";
import { ChartLegend } from "@/components/charts/chart-legend";
import {
  ScoreLineChart,
  type ScorePoint,
} from "@/components/charts/score-line-chart";
import { AppShell } from "@/components/layout/app-shell";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SuccessState,
} from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { IconPill } from "@/components/ui/icon-pill";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NonClinicalNotice } from "@/components/ui/non-clinical-notice";
import { StatCard } from "@/components/ui/stat-card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { DesignSystemDialogDemo } from "./dialog-demo";


export const dynamic = "force-dynamic";


export const metadata: Metadata = { title: "Design System" };

/** Dados ilustrativos da fundacao visual. Nenhum dado real, nenhum backend. */
const SAMPLE: ScorePoint[] = [
  { label: "Sex", mood: 6, anxiety: 5 },
  { label: "Sab", mood: 7, anxiety: 3 },
  { label: "Dom", mood: 5, anxiety: 5 },
  { label: "Seg", mood: 7, anxiety: 4 },
  { label: "Ter", mood: 8, anxiety: 2 },
  { label: "Qua", mood: null, anxiety: null },
  { label: "Qui", mood: 8, anxiety: 3 },
];

const SERIES = [
  { key: "mood" as const, label: "Humor" },
  { key: "anxiety" as const, label: "Ansiedade percebida" },
];

const SWATCHES: Array<[string, string]> = [
  ["identity-600 (marca)", "bg-identity-600"],
  ["identity-50", "bg-identity-50"],
  ["brand-600 (interação)", "bg-brand-600"],
  ["brand-100", "bg-brand-100"],
  ["brand-400", "bg-brand-400"],
  ["surface-brand", "bg-surface-brand"],
  ["positive", "bg-positive"],
  ["attention", "bg-attention"],
  ["destructive", "bg-destructive"],
  ["cycle", "bg-cycle"],
  ["metric-sleep", "bg-metric-sleep"],
  ["metric-energy", "bg-metric-energy"],
  ["metric-anxiety", "bg-metric-anxiety"],
  ["canvas", "bg-canvas"],
  ["surface-muted", "bg-surface-muted"],
  ["surface-sunken", "bg-surface-sunken"],
  ["line", "bg-line"],
  ["line-input", "bg-line-input"],
  ["ink", "bg-ink"],
];

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {note ? <p className="mt-1 text-sm text-ink-muted">{note}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function DesignSystemPage() {
  return (
    <AppShell userInitials="P">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Design System
        </h1>
        <p className="mt-1 max-w-2xl text-ink-muted">
          Design System V2 da Elyra (Stage 24, ADR-0013): teal como marca,
          periwinkle como interação, alvos de 44px no celular. Esta página existe
          para QA visual e não faz parte das jornadas do produto.
        </p>
      </header>

      <Section
        title="Cores"
        note="Rosa pertence ao domínio de ciclo. Vermelho pertence a ação destrutiva."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {SWATCHES.map(([name, cls]) => (
            <div key={name} className="rounded-control border border-line p-2">
              <div className={`h-12 rounded-md ${cls}`} />
              <p className="mt-2 text-xs text-ink-muted">{name}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Botões">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Ativar acompanhamento</Button>
          <Button variant="secondary">Agora não</Button>
          <Button variant="soft">Ver relatório</Button>
          <Button variant="ghost">Cancelar</Button>
          <Button variant="destructive">Finalizar sessão</Button>
          <Button variant="link">Ver insights</Button>
          <Button size="sm">Pequeno</Button>
          <Button size="lg">Grande</Button>
          <Button disabled>Desabilitado</Button>
        </div>
      </Section>

      <Section
        title="Stat cards"
        note="Valor ausente renderiza 'Sem registro', nunca zero."
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Ansiedade percebida"
            value="4,2"
            unit="/10"
            tone="anxiety"
            icon={<Brain />}
            hint="Valor autorrelatado, não medido."
            delta={{
              direction: "down",
              label: "0,8 desde a semana passada",
              isPositive: true,
            }}
          />
          <StatCard
            label="Qualidade do sono"
            value="7,6"
            unit="/10"
            tone="sleep"
            icon={<Moon />}
            delta={{
              direction: "up",
              label: "0,6 desde a semana passada",
              isPositive: true,
            }}
          />
          <StatCard
            label="Horas dormidas"
            value="7h 12m"
            tone="sleep"
            icon={<Bed />}
          />
          <StatCard
            label="Energia"
            value={null}
            unit="/10"
            tone="energy"
            icon={<BatteryCharging />}
          />
        </div>
      </Section>

      <Section
        title="Gráfico"
        note="Série tracejada distingue ansiedade de humor. Lacuna não é interpolada."
      >
        <ChartCard
          title="Evolução emocional"
          description="Seu humor e ansiedade percebida ao longo da semana."
          hint="Séries determinísticas derivadas dos seus registros."
          action={<Badge tone="brand">Últimos 7 dias</Badge>}
        >
          <ChartLegend items={SERIES} className="mb-3" />
          <ScoreLineChart data={SAMPLE} series={SERIES} />
        </ChartCard>
      </Section>

      <Section title="Formulário">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Como foi seu dia?</CardTitle>
            <CardDescription>
              Campos opcionais ficam sem registro.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-feeling">Sentimento predominante</Label>
              <Input id="ds-feeling" placeholder="Tranquilo" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-note">Observação</Label>
              <Textarea id="ds-note" placeholder="Opcional" />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="ds-switch">Usar microfone</Label>
              <Switch id="ds-switch" defaultChecked />
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section title="Chips e pílulas">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="brand">BETA</Badge>
          <Badge tone="positive">Análise concluída</Badge>
          <Badge tone="positive">Compartilhado</Badge>
          <Badge tone="neutral">Não compartilhado</Badge>
          <Badge tone="attention">Atenção</Badge>
          <Badge tone="cycle">Menstruação</Badge>
          <Badge tone="destructive">Excluir</Badge>
          <IconPill tone="cycle">
            <Flower2 />
          </IconPill>
          <IconPill tone="brand">
            <Sparkles />
          </IconPill>
        </div>
      </Section>

      <Section title="Abas">
        <Tabs defaultValue="visao">
          <TabsList>
            <TabsTrigger value="visao">Visão geral</TabsTrigger>
            <TabsTrigger value="evolucao">Evolução</TabsTrigger>
            <TabsTrigger value="sono">Sono</TabsTrigger>
          </TabsList>
          <TabsContent value="visao">
            <p className="text-sm text-ink-muted">Conteúdo da visão geral.</p>
          </TabsContent>
          <TabsContent value="evolucao">
            <p className="text-sm text-ink-muted">Conteúdo de evolução.</p>
          </TabsContent>
          <TabsContent value="sono">
            <p className="text-sm text-ink-muted">Conteúdo de sono.</p>
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Dialog">
        <DesignSystemDialogDemo />
      </Section>

      <Section title="Estados">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <LoadingState />
          </Card>
          <Card>
            <EmptyState
              title="Este usuário não compartilhou dados do diário."
              description="Quando disponível, os registros aparecerão aqui."
            />
          </Card>
          <Card>
            <ErrorState />
          </Card>
          <Card className="p-4">
            <SuccessState
              title="Registro salvo"
              description="Seu check-in foi guardado."
            />
          </Card>
        </div>
      </Section>

      <Section
        title="Aviso não clínico"
        note="Componente de produto obrigatório em toda superficie que interpreta dados."
      >
        <div className="flex flex-col gap-3">
          <NonClinicalNotice context="insight" />
          <NonClinicalNotice context="report" />
          <NonClinicalNotice context="session" />
        </div>
      </Section>
    </AppShell>
  );
}
