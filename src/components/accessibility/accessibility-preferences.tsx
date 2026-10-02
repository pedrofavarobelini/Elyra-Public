"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

export const ACCESSIBILITY_STORAGE_KEY = "elyra.accessibility.v1";

export type TextSize = "small" | "default" | "large" | "xlarge";
export type ContrastPreference = "default" | "reinforced";
export type MotionPreference = "system" | "reduce";
export type ThemePreference = "light" | "dark" | "system";
export type AccentPreference = "violet" | "teal" | "blue";
export type CardStylePreference = "standard" | "soft" | "elevated";
export type BackgroundPreference = "neutral" | "warm" | "cool";
export type DensityPreference = "compact" | "comfortable" | "spacious";
export type CardShapePreference = "minimal" | "balanced" | "rounded";
export type NavigationPreference = "expanded" | "compact";

export interface AccessibilityPreferences {
  textSize: TextSize;
  contrast: ContrastPreference;
  motion: MotionPreference;
  theme: ThemePreference;
  accent: AccentPreference;
  background: BackgroundPreference;
  cardStyle: CardStylePreference;
  density: DensityPreference;
  cardShape: CardShapePreference;
  navigation: NavigationPreference;
}

export const DEFAULT_ACCESSIBILITY_PREFERENCES: AccessibilityPreferences = {
  textSize: "default",
  contrast: "default",
  motion: "system",
  theme: "system",
  accent: "violet",
  background: "neutral",
  cardStyle: "standard",
  density: "comfortable",
  cardShape: "balanced",
  navigation: "expanded",
};

const TEXT_SIZES: readonly TextSize[] = ["small", "default", "large", "xlarge"];
const THEMES: readonly ThemePreference[] = ["light", "dark", "system"];
const ACCENTS: readonly AccentPreference[] = ["violet", "teal", "blue"];
const CARD_STYLES: readonly CardStylePreference[] = ["standard", "soft", "elevated"];
const BACKGROUNDS: readonly BackgroundPreference[] = ["neutral", "warm", "cool"];
const DENSITIES: readonly DensityPreference[] = ["compact", "comfortable", "spacious"];
const CARD_SHAPES: readonly CardShapePreference[] = ["minimal", "balanced", "rounded"];
const NAVIGATIONS: readonly NavigationPreference[] = ["expanded", "compact"];

function isTextSize(value: unknown): value is TextSize {
  return typeof value === "string" && TEXT_SIZES.includes(value as TextSize);
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}

/**
 * Le a preferencia salva. O schema cresce por **campos opcionais**: um JSON
 * gravado antes de densidade/formato/navegacao existirem continua valido, mantem
 * todas as escolhas antigas e recebe o padrao so nos campos que nao conhecia.
 * Por isso a chave `elyra.accessibility.v1` nao precisou mudar — trocar a chave
 * apagaria a preferencia de quem ja tinha escolhido tema e contraste.
 */
export function parseAccessibilityPreferences(value: string | null): AccessibilityPreferences {
  if (!value) return DEFAULT_ACCESSIBILITY_PREFERENCES;

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      textSize: isTextSize(parsed.textSize) ? parsed.textSize : "default",
      contrast: parsed.contrast === "reinforced" ? "reinforced" : "default",
      motion: parsed.motion === "reduce" ? "reduce" : "system",
      theme: isOneOf(THEMES, parsed.theme) ? parsed.theme : "system",
      accent: isOneOf(ACCENTS, parsed.accent) ? parsed.accent : "violet",
      background: isOneOf(BACKGROUNDS, parsed.background) ? parsed.background : "neutral",
      cardStyle: isOneOf(CARD_STYLES, parsed.cardStyle) ? parsed.cardStyle : "standard",
      density: isOneOf(DENSITIES, parsed.density) ? parsed.density : "comfortable",
      cardShape: isOneOf(CARD_SHAPES, parsed.cardShape) ? parsed.cardShape : "balanced",
      navigation: isOneOf(NAVIGATIONS, parsed.navigation) ? parsed.navigation : "expanded",
    };
  } catch {
    return DEFAULT_ACCESSIBILITY_PREFERENCES;
  }
}

export function applyAccessibilityPreferences(
  root: Pick<HTMLElement, "dataset">,
  preferences: AccessibilityPreferences,
) {
  root.dataset.elyraTextSize = preferences.textSize;
  root.dataset.elyraContrast = preferences.contrast;
  root.dataset.elyraMotion = preferences.motion;
  root.dataset.elyraTheme = preferences.theme;
  root.dataset.elyraAccent = preferences.accent;
  root.dataset.elyraBackground = preferences.background;
  root.dataset.elyraCardStyle = preferences.cardStyle;
  root.dataset.elyraDensity = preferences.density;
  root.dataset.elyraCardShape = preferences.cardShape;
  root.dataset.elyraNavigation = preferences.navigation;
}

interface AccessibilityContextValue {
  preferences: AccessibilityPreferences;
  update: (patch: Partial<AccessibilityPreferences>) => void;
  reset: () => void;
  setStorageScope: (userId: string | null) => void;
}

const AccessibilityContext = createContext<AccessibilityContextValue | null>(null);

/**
 * Contrato de tema (gate de freeze, 24/09/2026).
 *
 * - **Contexto publico** (Login, Cadastro, recuperacao, sem conta no escopo):
 *   padroes, ou seja `theme = system` e o tema do aparelho via
 *   `prefers-color-scheme` no CSS. O HTML do servidor ja nasce assim, entao o
 *   primeiro quadro esta certo e nenhum JS troca o tema depois.
 * - **Conta autenticada**: `AccessibilityPreferenceScope` ativa
 *   `elyra.accessibility.v1:<uuid>`. `light`/`dark` da conta vencem o aparelho;
 *   `system` segue o aparelho.
 * - **Logout**: o escopo sai e o painel volta aos padroes na hora.
 *
 * A chave sem sufixo (`elyra.accessibility.v1`) e legado de antes do isolamento
 * por conta (22/09). O defeito do QA vinha daqui: sem escopo, o provider a lia e
 * pintava o Login com o tema de uma conta anterior. Ela nao e mais lida nem
 * gravada fora do escopo; so migra, uma vez, para a primeira conta que entrar
 * sem preferencia propria (preserva a escolha antiga, nada e apagado a toa).
 */
export function AccessibilityPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState(DEFAULT_ACCESSIBILITY_PREFERENCES);
  /** `null` = contexto publico: nada e lido nem persistido. */
  const [storageKey, setStorageKey] = useState<string | null>(null);

  const read = useCallback((key: string) => {
    try {
      return parseAccessibilityPreferences(window.localStorage.getItem(key));
    } catch {
      return DEFAULT_ACCESSIBILITY_PREFERENCES;
    }
  }, []);

  const activateStorage = useCallback((userId: string | null) => {
    if (!userId) {
      // Logout: nada da conta que saiu continua pintando a tela publica.
      setStorageKey(null);
      setPreferences(DEFAULT_ACCESSIBILITY_PREFERENCES);
      applyAccessibilityPreferences(document.documentElement, DEFAULT_ACCESSIBILITY_PREFERENCES);
      return;
    }
    const nextKey = `${ACCESSIBILITY_STORAGE_KEY}:${userId}`;

    try {
      /* Migra a preferencia local antiga uma unica vez para a conta ativa. */
      if (!window.localStorage.getItem(nextKey)) {
        const legacy = window.localStorage.getItem(ACCESSIBILITY_STORAGE_KEY);
        if (legacy) {
          window.localStorage.setItem(nextKey, legacy);
          window.localStorage.removeItem(ACCESSIBILITY_STORAGE_KEY);
        }
      }
    } catch {
      // Storage indisponivel degrada para os padroes, sem bloquear a interface.
    }

    const next = read(nextKey);
    setStorageKey(nextKey);
    setPreferences(next);
    applyAccessibilityPreferences(document.documentElement, next);
  }, [read]);

  useEffect(() => {
    if (!storageKey) return;
    const syncAcrossTabs = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      const next = parseAccessibilityPreferences(event.newValue);
      setPreferences(next);
      applyAccessibilityPreferences(document.documentElement, next);
    };

    window.addEventListener("storage", syncAcrossTabs);
    return () => window.removeEventListener("storage", syncAcrossTabs);
  }, [storageKey]);

  const value = useMemo<AccessibilityContextValue>(
    () => ({
      preferences,
      update: (patch) => {
        setPreferences((current) => {
          const next = { ...current, ...patch };
          applyAccessibilityPreferences(document.documentElement, next);
          // Sem conta no escopo a mudanca vale so nesta pagina: nada vai para o aparelho.
          if (!storageKey) return next;
          try {
            window.localStorage.setItem(storageKey, JSON.stringify(next));
          } catch {
            // A preferencia segue valida nesta sessao mesmo sem persistencia.
          }
          return next;
        });
      },
      reset: () => {
        try {
          if (storageKey) window.localStorage.removeItem(storageKey);
        } catch {
          // Reset visual continua mesmo quando o storage esta indisponivel.
        }
        applyAccessibilityPreferences(document.documentElement, DEFAULT_ACCESSIBILITY_PREFERENCES);
        setPreferences(DEFAULT_ACCESSIBILITY_PREFERENCES);
      },
      setStorageScope: activateStorage,
    }),
    [activateStorage, preferences, storageKey],
  );

  return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>;
}

/** Isola as preferencias locais pelo UUID da conta autenticada neste aparelho. */
export function AccessibilityPreferenceScope({ userId }: { userId: string }) {
  const { setStorageScope } = useAccessibilityPreferences();

  // Layout effect: na navegacao pos-login, a preferencia da conta entra antes do
  // quadro seguinte ser pintado.
  useLayoutEffect(() => {
    setStorageScope(userId);
    return () => setStorageScope(null);
  }, [setStorageScope, userId]);

  return null;
}

export function useAccessibilityPreferences() {
  const context = useContext(AccessibilityContext);
  if (!context) throw new Error("useAccessibilityPreferences requer AccessibilityPreferencesProvider");
  return context;
}
