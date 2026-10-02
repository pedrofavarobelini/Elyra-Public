import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ACCESSIBILITY_STORAGE_KEY,
  AccessibilityPreferenceScope,
  AccessibilityPreferencesProvider,
  parseAccessibilityPreferences,
} from "./accessibility-preferences";
import { PersonalizationCenter } from "./personalization-center";

describe("preferencias de acessibilidade", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-elyra-text-size");
    document.documentElement.removeAttribute("data-elyra-contrast");
    document.documentElement.removeAttribute("data-elyra-motion");
    document.documentElement.removeAttribute("data-elyra-theme");
    document.documentElement.removeAttribute("data-elyra-accent");
    document.documentElement.removeAttribute("data-elyra-card-style");
    document.documentElement.removeAttribute("data-elyra-background");
    document.documentElement.removeAttribute("data-elyra-density");
    document.documentElement.removeAttribute("data-elyra-card-shape");
    document.documentElement.removeAttribute("data-elyra-navigation");
  });

  it("falha de forma segura com armazenamento ausente, invalido ou adulterado", () => {
    expect(parseAccessibilityPreferences(null).textSize).toBe("default");
    expect(parseAccessibilityPreferences("nao-json").contrast).toBe("default");
    expect(parseAccessibilityPreferences('{"textSize":"gigante","motion":"force"}')).toEqual({
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
    });
  });

  it("preserva preferencias gravadas antes de densidade, formato e navegacao existirem", () => {
    const legacy = JSON.stringify({
      textSize: "large",
      contrast: "reinforced",
      motion: "reduce",
      theme: "dark",
      accent: "blue",
      background: "cool",
      cardStyle: "soft",
    });

    expect(parseAccessibilityPreferences(legacy)).toEqual({
      textSize: "large",
      contrast: "reinforced",
      motion: "reduce",
      theme: "dark",
      accent: "blue",
      background: "cool",
      cardStyle: "soft",
      density: "comfortable",
      cardShape: "balanced",
      navigation: "expanded",
    });
    expect(
      parseAccessibilityPreferences('{"density":"gigante","cardShape":"#fff","navigation":"flutuante"}'),
    ).toMatchObject({ density: "comfortable", cardShape: "balanced", navigation: "expanded" });
  });

  it("persiste e aplica leitura, tema, accent, fundo, cards e movimento no elemento raiz", () => {
    render(
      <AccessibilityPreferencesProvider>
        <AccessibilityPreferenceScope userId="user-a" />
        <PersonalizationCenter />
      </AccessibilityPreferencesProvider>,
    );

    act(() => fireEvent.click(screen.getByRole("button", { name: "Muito maior" })));
    act(() => fireEvent.click(screen.getByRole("button", { name: "Contraste reforçado" })));
    act(() => fireEvent.click(screen.getByRole("button", { name: "Reduzir sempre" })));
    act(() => fireEvent.click(screen.getByRole("button", { name: "Escuro" })));
    act(() => fireEvent.click(screen.getByRole("button", { name: "Verde sereno" })));
    act(() => fireEvent.click(screen.getByRole("button", { name: "Acolhedor" })));
    act(() => fireEvent.click(screen.getByRole("button", { name: "Elevado" })));
    act(() => fireEvent.click(screen.getByRole("button", { name: "Compacta" })));
    act(() => fireEvent.click(screen.getByRole("button", { name: "Arredondado" })));
    act(() => fireEvent.click(screen.getByRole("button", { name: "Só ícones" })));

    expect(document.documentElement.dataset.elyraTextSize).toBe("xlarge");
    expect(document.documentElement.dataset.elyraContrast).toBe("reinforced");
    expect(document.documentElement.dataset.elyraMotion).toBe("reduce");
    expect(document.documentElement.dataset.elyraTheme).toBe("dark");
    expect(document.documentElement.dataset.elyraAccent).toBe("teal");
    expect(document.documentElement.dataset.elyraBackground).toBe("warm");
    expect(document.documentElement.dataset.elyraCardStyle).toBe("elevated");
    expect(document.documentElement.dataset.elyraDensity).toBe("compact");
    expect(document.documentElement.dataset.elyraCardShape).toBe("rounded");
    expect(document.documentElement.dataset.elyraNavigation).toBe("compact");
    expect(screen.getByRole("button", { name: "Só ícones" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Barra completa" })).toHaveAttribute("aria-pressed", "false");
    expect(JSON.parse(window.localStorage.getItem(`${ACCESSIBILITY_STORAGE_KEY}:user-a`) ?? "{}")).toEqual({
      textSize: "xlarge",
      contrast: "reinforced",
      motion: "reduce",
      theme: "dark",
      accent: "teal",
      background: "warm",
      cardStyle: "elevated",
      density: "compact",
      cardShape: "rounded",
      navigation: "compact",
    });
  });

  it("restaura o padrao sem manter residuo", () => {
    window.localStorage.setItem(
      `${ACCESSIBILITY_STORAGE_KEY}:user-a`,
      JSON.stringify({
        textSize: "large",
        contrast: "reinforced",
        motion: "reduce",
        background: "cool",
        density: "spacious",
        cardShape: "minimal",
        navigation: "compact",
      }),
    );

    render(
      <AccessibilityPreferencesProvider>
        <AccessibilityPreferenceScope userId="user-a" />
        <PersonalizationCenter />
      </AccessibilityPreferencesProvider>,
    );
    act(() => fireEvent.click(screen.getByRole("button", { name: "Restaurar padrão" })));

    expect(window.localStorage.getItem(`${ACCESSIBILITY_STORAGE_KEY}:user-a`)).toBeNull();
    expect(document.documentElement.dataset.elyraTextSize).toBe("default");
    expect(document.documentElement.dataset.elyraTheme).toBe("system");
    expect(document.documentElement.dataset.elyraAccent).toBe("violet");
    expect(document.documentElement.dataset.elyraBackground).toBe("neutral");
    expect(document.documentElement.dataset.elyraCardStyle).toBe("standard");
    expect(document.documentElement.dataset.elyraDensity).toBe("comfortable");
    expect(document.documentElement.dataset.elyraCardShape).toBe("balanced");
    expect(document.documentElement.dataset.elyraNavigation).toBe("expanded");
  });

  it("mantem a previa fora da ordem de tabulacao e da arvore de acessibilidade", () => {
    render(
      <AccessibilityPreferencesProvider>
        <PersonalizationCenter />
      </AccessibilityPreferencesProvider>,
    );
    const preview = screen.getByTestId("personalization-preview");
    expect(preview).toHaveAttribute("aria-hidden", "true");
    expect(preview.querySelectorAll("a, button, input, select, textarea, [tabindex]")).toHaveLength(0);
  });

  it("migra o legado e isola preferencias por conta neste dispositivo", () => {
    window.localStorage.setItem(
      ACCESSIBILITY_STORAGE_KEY,
      JSON.stringify({ theme: "dark", accent: "blue", cardStyle: "soft" }),
    );

    const { unmount } = render(
      <AccessibilityPreferencesProvider>
        <AccessibilityPreferenceScope userId="user-a" />
        <PersonalizationCenter />
      </AccessibilityPreferencesProvider>,
    );

    expect(window.localStorage.getItem(ACCESSIBILITY_STORAGE_KEY)).toBeNull();
    expect(
      JSON.parse(window.localStorage.getItem(`${ACCESSIBILITY_STORAGE_KEY}:user-a`) ?? "{}"),
    ).toMatchObject({ theme: "dark", accent: "blue", cardStyle: "soft" });
    act(() => fireEvent.click(screen.getByRole("button", { name: "Verde sereno" })));
    expect(
      JSON.parse(window.localStorage.getItem(`${ACCESSIBILITY_STORAGE_KEY}:user-a`) ?? "{}"),
    ).toMatchObject({ accent: "teal" });

    unmount();
    expect(window.localStorage.getItem(`${ACCESSIBILITY_STORAGE_KEY}:user-b`)).toBeNull();
  });
  /*
   * Contrato de tema publico x conta (gate de freeze, 24/09). A resolucao
   * light/dark de `system` e CSS (`prefers-color-scheme`); aqui o contrato e o
   * que vai para `data-elyra-theme` e para o storage.
   */
  describe("contrato de tema publico x conta", () => {
    const keyOf = (user: string) => `${ACCESSIBILITY_STORAGE_KEY}:${user}`;
    const store = (key: string, theme: string) =>
      window.localStorage.setItem(key, JSON.stringify({ theme }));
    const theme = () => document.documentElement.dataset.elyraTheme;

    function Scoped({ user }: { user: string | null }) {
      return (
        <AccessibilityPreferencesProvider>
          {user ? <AccessibilityPreferenceScope userId={user} /> : null}
        </AccessibilityPreferencesProvider>
      );
    }

    it("Auth publico ignora a chave legada de aparelho e segue o sistema", () => {
      store(ACCESSIBILITY_STORAGE_KEY, "dark");
      document.documentElement.dataset.elyraTheme = "system";
      render(<Scoped user={null} />);
      expect(theme()).toBe("system");
      // O legado nao e apagado: continua disponivel para migrar a primeira conta.
      expect(window.localStorage.getItem(ACCESSIBILITY_STORAGE_KEY)).not.toBeNull();
    });

    it("Auth publico nao le a preferencia de nenhuma conta salva no aparelho", () => {
      store(keyOf("user-a"), "dark");
      document.documentElement.dataset.elyraTheme = "system";
      render(<Scoped user={null} />);
      expect(theme()).toBe("system");
    });

    it.each(["light", "dark", "system"])("conta com tema %s aplica exatamente esse tema", (value) => {
      store(keyOf("user-a"), value);
      render(<Scoped user="user-a" />);
      expect(theme()).toBe(value);
    });

    it.each(["light", "dark"])("logout de conta %s volta o Auth ao tema do aparelho", (value) => {
      store(keyOf("user-a"), value);
      const view = render(<Scoped user="user-a" />);
      expect(theme()).toBe(value);
      view.rerender(<Scoped user={null} />);
      expect(theme()).toBe("system");
      // A preferencia da conta continua salva para o proximo login dela.
      expect(JSON.parse(window.localStorage.getItem(keyOf("user-a")) ?? "{}")).toMatchObject({ theme: value });
    });

    it("A escuro -> logout -> B claro: nada de A contamina B", () => {
      store(keyOf("user-a"), "dark");
      store(keyOf("user-b"), "light");
      const view = render(<Scoped user="user-a" />);
      expect(theme()).toBe("dark");
      view.rerender(<Scoped user={null} />);
      expect(theme()).toBe("system");
      view.rerender(<Scoped user="user-b" />);
      expect(theme()).toBe("light");
      expect(JSON.parse(window.localStorage.getItem(keyOf("user-a")) ?? "{}")).toMatchObject({ theme: "dark" });
    });

    it("conta nova sem preferencia nao herda o tema da conta anterior", () => {
      store(keyOf("user-a"), "dark");
      const view = render(<Scoped user="user-a" />);
      view.rerender(<Scoped user={null} />);
      view.rerender(<Scoped user="user-c" />);
      expect(theme()).toBe("system");
      expect(window.localStorage.getItem(keyOf("user-c"))).toBeNull();
    });

    it("sem conta no escopo, mudanca de preferencia nao vai para o aparelho", () => {
      render(
        <AccessibilityPreferencesProvider>
          <PersonalizationCenter />
        </AccessibilityPreferencesProvider>,
      );
      act(() => fireEvent.click(screen.getByRole("button", { name: "Escuro" })));
      expect(theme()).toBe("dark");
      expect(Object.keys(window.localStorage)).toEqual([]);
    });
  });
});
