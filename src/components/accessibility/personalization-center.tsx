"use client";

import { ChevronRight, Palette } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import {
  useAccessibilityPreferences,
  type AccentPreference,
  type AccessibilityPreferences,
  type BackgroundPreference,
  type CardShapePreference,
  type CardStylePreference,
  type ContrastPreference,
  type DensityPreference,
  type MotionPreference,
  type NavigationPreference,
  type TextSize,
  type ThemePreference,
} from "@/components/accessibility/accessibility-preferences";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { IconPill } from "@/components/ui/icon-pill";
import { cn } from "@/lib/utils";

/**
 * Central de Personalizacao (`/configuracoes/personalizacao`).
 *
 * Fonte unica dos controles visuais: o hub de Configuracoes so mostra a entrada
 * e um resumo. O estado continua sendo o do `AccessibilityPreferencesProvider`
 * — nenhum store paralelo —, entao a mudanca vale para o app inteiro no mesmo
 * clique e sobrevive a reload pela mesma chave por conta.
 *
 * Todo controle e um preset fechado com `aria-pressed`. Nao ha HEX livre, CSS
 * livre nem slider: cada combinacao possivel foi medida para contraste.
 */

type Option<T extends string> = { value: T; label: string };

const THEME_OPTIONS: ReadonlyArray<Option<ThemePreference>> = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
  { value: "system", label: "Seguir dispositivo" },
];

const ACCENT_OPTIONS: ReadonlyArray<Option<AccentPreference>> = [
  { value: "violet", label: "Lavanda Elyra" },
  { value: "teal", label: "Verde sereno" },
  { value: "blue", label: "Azul tranquilo" },
];

const BACKGROUND_OPTIONS: ReadonlyArray<Option<BackgroundPreference>> = [
  { value: "neutral", label: "Neutro" },
  { value: "warm", label: "Acolhedor" },
  { value: "cool", label: "Sereno" },
];

const CARD_STYLE_OPTIONS: ReadonlyArray<Option<CardStylePreference>> = [
  { value: "standard", label: "Padrão" },
  { value: "soft", label: "Suave" },
  { value: "elevated", label: "Elevado" },
];

const TEXT_OPTIONS: ReadonlyArray<Option<TextSize>> = [
  { value: "small", label: "Menor" },
  { value: "default", label: "Padrão" },
  { value: "large", label: "Maior" },
  { value: "xlarge", label: "Muito maior" },
];

const CONTRAST_OPTIONS: ReadonlyArray<Option<ContrastPreference>> = [
  { value: "default", label: "Padrão" },
  { value: "reinforced", label: "Contraste reforçado" },
];

const MOTION_OPTIONS: ReadonlyArray<Option<MotionPreference>> = [
  { value: "system", label: "Seguir o dispositivo" },
  { value: "reduce", label: "Reduzir sempre" },
];

const DENSITY_OPTIONS: ReadonlyArray<Option<DensityPreference>> = [
  { value: "compact", label: "Compacta" },
  { value: "comfortable", label: "Confortável" },
  { value: "spacious", label: "Espaçosa" },
];

const CARD_SHAPE_OPTIONS: ReadonlyArray<Option<CardShapePreference>> = [
  { value: "minimal", label: "Minimal" },
  { value: "balanced", label: "Equilibrado" },
  { value: "rounded", label: "Arredondado" },
];

const NAVIGATION_OPTIONS: ReadonlyArray<Option<NavigationPreference>> = [
  { value: "expanded", label: "Barra completa" },
  { value: "compact", label: "Só ícones" },
];

function labelOf<T extends string>(options: ReadonlyArray<Option<T>>, value: T) {
  return options.find((option) => option.value === value)?.label ?? value;
}

/** Resumo curto para o hub. So o que a pessoa reconhece de relance. */
const THEME_SUMMARY: Record<ThemePreference, string> = {
  light: "Tema claro",
  dark: "Tema escuro",
  system: "Tema do dispositivo",
};

export function personalizationSummary(preferences: AccessibilityPreferences) {
  return [
    THEME_SUMMARY[preferences.theme],
    labelOf(ACCENT_OPTIONS, preferences.accent),
    `densidade ${labelOf(DENSITY_OPTIONS, preferences.density).toLowerCase()}`,
  ].join(" · ");
}

function ChoiceButton({
  selected,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { selected: boolean }) {
  return (
    <Button
      type="button"
      variant={selected ? "primary" : "secondary"}
      aria-pressed={selected}
      className={cn("h-auto min-h-11 whitespace-normal", className)}
      {...props}
    />
  );
}

function PresetGroup<T extends string>({
  legend,
  hint,
  options,
  value,
  onChange,
  columns = 3,
  swatch,
}: {
  legend: string;
  hint: string;
  options: ReadonlyArray<Option<T>>;
  value: T;
  onChange: (value: T) => void;
  columns?: 2 | 3 | 4;
  swatch?: (value: T) => React.ReactNode;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      <p className="mt-1 text-sm text-ink-muted">{hint}</p>
      <div
        className={cn(
          "mt-3 grid gap-2",
          columns === 2 && "sm:grid-cols-2",
          columns === 3 && "sm:grid-cols-3",
          columns === 4 && "grid-cols-2 sm:grid-cols-4",
        )}
      >
        {options.map((option) => (
          <ChoiceButton
            key={option.value}
            selected={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {swatch?.(option.value)}
            {option.label}
          </ChoiceButton>
        ))}
      </div>
    </fieldset>
  );
}

function Group({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} id={id} className="scroll-mt-20">
      <Card>
        <CardHeader>
          <h2 id={`${id}-title`} className="text-base font-semibold text-ink lg:text-lg">
            {title}
          </h2>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">{children}</CardContent>
      </Card>
    </section>
  );
}

/**
 * Preview com os MESMOS tokens do app: e um `Card` de verdade, com as classes
 * semanticas de sempre, entao reflete tema, fundo, destaque, aparencia, raio e
 * densidade porque herda os atributos do `<html>` — nao ha mini-tema paralelo.
 * E decorativo: `aria-hidden`, sem nenhum elemento focavel; o resumo textual
 * logo abaixo e o que o leitor de tela ouve.
 */
function PersonalizationPreview({ preferences }: { preferences: AccessibilityPreferences }) {
  return (
    <section aria-labelledby="personalization-preview-title" className="flex flex-col gap-3">
      <h2 id="personalization-preview-title" className="text-sm font-semibold uppercase tracking-wide text-ink-subtle">
        Prévia
      </h2>
      <div
        aria-hidden="true"
        data-testid="personalization-preview"
        className="elyra-canvas rounded-panel border border-line p-4"
      >
        <Card>
          <CardHeader>
            <p className="text-base font-semibold text-ink">Como você está hoje?</p>
            <CardDescription>Um registro rápido, no seu ritmo.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="rounded-control bg-surface-muted px-3 py-2 text-sm text-ink-muted">
              Texto secundário sobre a superfície suave.
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex min-h-9 items-center rounded-control bg-brand-600 px-3 text-sm font-medium text-white">
                Registrar agora
              </span>
              <span className="inline-flex min-h-9 items-center rounded-pill bg-brand-100 px-3 text-sm font-medium text-brand-700">
                Destaque
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
      <p className="text-sm text-ink-muted" data-testid="personalization-summary">
        {personalizationSummary(preferences)} · cards {labelOf(CARD_STYLE_OPTIONS, preferences.cardStyle).toLowerCase()},{" "}
        formato {labelOf(CARD_SHAPE_OPTIONS, preferences.cardShape).toLowerCase()}.
      </p>
    </section>
  );
}

export function PersonalizationCenter() {
  const { preferences, update, reset } = useAccessibilityPreferences();

  return (
    <div className="grid items-start gap-[var(--density-stack)] xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
      <div className="flex min-w-0 flex-col gap-[var(--density-stack)]">
        <Group
          id="personalizacao-aparencia"
          title="Aparência"
          description="Cores e superfícies da Elyra neste aparelho. Todos os presets foram medidos em claro e escuro."
        >
          <PresetGroup
            legend="Tema"
            hint="“Seguir dispositivo” acompanha o claro e o escuro do sistema automaticamente."
            options={THEME_OPTIONS}
            value={preferences.theme}
            onChange={(theme) => update({ theme })}
          />
          <PresetGroup
            legend="Cor de destaque"
            hint="Muda botões e seleções. Alertas, erros e o SOS mantêm suas cores."
            options={ACCENT_OPTIONS}
            value={preferences.accent}
            onChange={(accent) => update({ accent })}
            swatch={(value) => (
              <span className={`appearance-accent-swatch appearance-accent-swatch-${value}`} aria-hidden="true" />
            )}
          />
          <PresetGroup
            legend="Fundo do aplicativo"
            hint="Desloca só as superfícies. O texto mantém o mesmo contraste mínimo em todos."
            options={BACKGROUND_OPTIONS}
            value={preferences.background}
            onChange={(background) => update({ background })}
            swatch={(value) => (
              <span className={`appearance-surface-swatch appearance-surface-swatch-${value}`} aria-hidden="true" />
            )}
          />
          <PresetGroup
            legend="Aparência dos cards"
            hint="Borda, preenchimento e elevação, sem mudar a hierarquia do conteúdo."
            options={CARD_STYLE_OPTIONS}
            value={preferences.cardStyle}
            onChange={(cardStyle) => update({ cardStyle })}
          />
        </Group>

        <Group
          id="personalizacao-leitura"
          title="Leitura e acessibilidade"
          description="Complementa o zoom do navegador e as preferências do sistema operacional."
        >
          <PresetGroup
            legend="Tamanho do texto"
            hint="Aumenta o texto sem cortar conteúdo."
            options={TEXT_OPTIONS}
            value={preferences.textSize}
            onChange={(textSize) => update({ textSize })}
            columns={4}
          />
          <PresetGroup
            legend="Contraste"
            hint="Reforça texto, bordas e foco sem mudar a identidade da Elyra."
            options={CONTRAST_OPTIONS}
            value={preferences.contrast}
            onChange={(contrast) => update({ contrast })}
            columns={2}
          />
          <PresetGroup
            legend="Movimento"
            hint="“Reduzir sempre” desliga animações mesmo quando o sistema permite."
            options={MOTION_OPTIONS}
            value={preferences.motion}
            onChange={(motion) => update({ motion })}
            columns={2}
          />
        </Group>

        <Group
          id="personalizacao-interface"
          title="Interface"
          description="Organização da tela. Botões e campos mantêm o mesmo tamanho de toque em qualquer escolha."
        >
          <PresetGroup
            legend="Densidade"
            hint="Espaço interno dos cards e entre as seções."
            options={DENSITY_OPTIONS}
            value={preferences.density}
            onChange={(density) => update({ density })}
          />
          <PresetGroup
            legend="Formato dos cards"
            hint="Arredondamento dos cantos."
            options={CARD_SHAPE_OPTIONS}
            value={preferences.cardShape}
            onChange={(cardShape) => update({ cardShape })}
          />
          <PresetGroup
            legend="Navegação no computador"
            hint="“Só ícones” estreita a barra lateral; o nome de cada destino aparece ao passar o mouse e continua disponível para leitores de tela. No celular a navegação não muda."
            options={NAVIGATION_OPTIONS}
            value={preferences.navigation}
            onChange={(navigation) => update({ navigation })}
            columns={2}
          />
        </Group>
      </div>

      <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-6">
        <Card>
          <CardContent className="flex flex-col gap-5">
            <PersonalizationPreview preferences={preferences} />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p role="status" aria-live="polite" className="text-sm text-ink-muted">
                Preferências aplicadas neste aparelho.
              </p>
              <Button type="button" variant="secondary" onClick={reset}>
                Restaurar padrão
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Entrada do hub de Configuracoes para a central. */
export function PersonalizationHubCard({
  className,
  href = "/configuracoes/personalizacao",
}: {
  className?: string;
  /** F4: a mesma pagina, montada no shell do contexto atual. */
  href?: string;
}) {
  const { preferences } = useAccessibilityPreferences();

  return (
    <section
      aria-labelledby="cfg-personalizacao-title"
      id="cfg-personalizacao"
      className={cn("scroll-mt-20", className)}
    >
      <Card>
        <CardHeader className="pb-2 sm:pb-2">
          <h2 id="cfg-personalizacao-title" className="text-base font-semibold text-ink lg:text-lg">
            Personalização
          </h2>
          <CardDescription>Escolha como a Elyra aparece e se adapta a você.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-1 pt-0 sm:px-0 sm:pb-1 sm:pt-0">
          <Link
            href={href as Route}
            className="motion-press group flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted/70"
          >
            <IconPill tone="brand" size="sm">
              <Palette />
            </IconPill>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink">
                Aparência, leitura e interface
              </span>
              <span className="block text-sm text-ink-muted" data-testid="personalization-hub-summary">
                {personalizationSummary(preferences)}
              </span>
            </span>
            <ChevronRight
              className="size-4 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        </CardContent>
      </Card>
    </section>
  );
}
