import { readFileSync } from "node:fs";
import path from "node:path";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SosButton } from "@/components/help/sos-button";
import { HELP_GROUPS, SOS_CAPABILITY } from "@/lib/contracts/help";



const h = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => h.pathname }));

const fetchSpy = vi.fn();

/** L-179: o botao nasce oculto e aparece depois da primeira avaliacao. */
const findTrigger = () => screen.findByRole("button", { name: /ajuda imediata/i });

beforeEach(() => {
  h.pathname = "/dashboard";
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

describe("SosButton", () => {
  it("abre o painel sem rede, sem localizacao e dizendo que nada e automatico", async () => {
    const geo = vi.fn();
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: geo, watchPosition: geo },
    });

    render(<SosButton />);
    await userEvent.click(await findTrigger());

    const dialog = await screen.findByRole("dialog", { name: "Precisa de ajuda agora?" });
    expect(dialog).toHaveTextContent(
      "A Elyra não aciona serviços de emergência automaticamente.",
    );
    expect(dialog).toHaveTextContent("sua localização não é enviada");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(geo).not.toHaveBeenCalled();
  });

  it("cada contato e um link explicito com o destino correto", async () => {
    render(<SosButton />);
    await userEvent.click(await findTrigger());
    await screen.findByRole("dialog");

    expect(screen.getByRole("link", { name: /SAMU/ })).toHaveAttribute("href", "tel:192");
    expect(screen.getByRole("link", { name: /Polícia Militar/ })).toHaveAttribute("href", "tel:190");
    expect(screen.getByRole("link", { name: /^CVV Ligação/ })).toHaveAttribute("href", "tel:188");
    const site = screen.getByRole("link", { name: /CVV por chat/ });
    expect(site).toHaveAttribute("href", "https://cvv.org.br");
    expect(site).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("SUP-2: so um link para a Rede de Apoio, depois dos contatos, sem rede nem localizacao", async () => {
    const geo = vi.fn();
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: geo, watchPosition: geo },
    });
    render(<SosButton />);
    await userEvent.click(await findTrigger());
    const dialog = await screen.findByRole("dialog");

    const link = screen.getByRole("link", { name: /Abrir Rede de Apoio/ });
    expect(link).toHaveAttribute("href", "/rede-de-apoio");
    // Secao propria, separada dos contatos imediatos, e dita nao emergencial.
    const section = screen.getByRole("region", { name: "Rede de Apoio" });
    expect(section).toContainElement(link);
    expect(section).toHaveTextContent("Não é emergência");
    // Vem depois dos contatos de emergencia: nunca no lugar deles.
    const links = [...dialog.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links.indexOf("/rede-de-apoio")).toBeGreaterThan(links.indexOf("tel:188"));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(geo).not.toHaveBeenCalled();
  });

  it("foco inicial no titulo, Escape fecha e devolve o foco ao botao", async () => {
    render(<SosButton />);
    const trigger = await findTrigger();
    await userEvent.click(trigger);

    const title = await screen.findByRole("heading", { name: "Precisa de ajuda agora?" });
    await waitFor(() => expect(title).toHaveFocus());

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("nao aparece no preparo/captura de sessao", () => {
    h.pathname = "/sessoes/nova";
    render(<SosButton />);
    expect(screen.queryByRole("button", { name: /ajuda imediata/i })).toBeNull();
  });
});

describe("contrato do SOS", () => {
  it("declara recursos externos so por iniciativa da pessoa, sem backend, localizacao ou disparo", () => {
    expect(SOS_CAPABILITY).toEqual({
      backend: "NONE",
      externalResources: "USER_INITIATED_PUBLIC_RESOURCES",
      externalContacts: "USER_INITIATED_ONLY",
      locationUsage: "NONE",
      automaticDispatch: "NEVER",
      telemetry: "NONE",
    });
  });

  it("so usa tel: ou https:, e nenhum arquivo do SOS fala com rede ou localizacao", () => {
    for (const group of HELP_GROUPS) {
      for (const contact of group.contacts) {
        expect(contact.href).toMatch(/^(tel:\d{3}|https:\/\/)/);
      }
    }
    const root = path.resolve(__dirname);
    for (const file of ["sos-button.tsx", "help-contacts.tsx"]) {
      const source = readFileSync(path.join(root, file), "utf8");
      expect(source).not.toMatch(/fetch\(|sendBeacon|geolocation|localStorage|console\./);
    }
  });
});
