// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PasskeyClientError } from "@/lib/passkeys";
import { PasskeyCard } from "./passkey-card";

const h = vi.hoisted(() => ({
  startRegistration: vi.fn(),
  finishRegistration: vi.fn(),
  deletePasskey: vi.fn(),
  createPasskey: vi.fn(),
  supportsPasskeys: vi.fn(),
}));

vi.mock("@/app/passkey-actions", () => ({
  startPasskeyRegistrationAction: h.startRegistration,
  finishPasskeyRegistrationAction: h.finishRegistration,
  deletePasskeyAction: h.deletePasskey,
}));

vi.mock("@/lib/passkeys", async (original) => ({
  ...(await original<object>()),
  createPasskey: h.createPasskey,
  browserSupportsPasskeys: h.supportsPasskeys,
}));

const owner = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Demo QA",
  initials: "PQ",
  email: "pedro-qa@elyra.invalid",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.supportsPasskeys.mockReturnValue(true);
  h.startRegistration.mockResolvedValue({
    status: "ready",
    challengeId: "22222222-2222-4222-8222-222222222222",
    options: { challenge: "AQID" },
  });
});

describe("PasskeyCard — identidade e cancelamento", () => {
  it("mostra a conta e exige confirmação antes da cerimônia", async () => {
    render(<PasskeyCard available initialPasskeys={[]} owner={owner} />);

    expect(screen.getByText(/Demo QA/)).toHaveTextContent(owner.email);
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar nova chave" }));

    const dialog = screen.getByRole("dialog", { name: "Confirmar conta da chave" });
    expect(dialog).toHaveTextContent(owner.name);
    expect(dialog).toHaveTextContent(owner.email);
    expect(h.startRegistration).not.toHaveBeenCalled();
  });

  it("cancelamento do WebAuthn não verifica nem altera credencial", async () => {
    h.createPasskey.mockRejectedValue(new PasskeyClientError("cancelled"));
    render(<PasskeyCard available initialPasskeys={[]} owner={owner} />);

    fireEvent.click(screen.getByRole("button", { name: "Cadastrar nova chave" }));
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar para esta conta" }));

    await expect(screen.findByRole("status")).resolves.toHaveTextContent(
      "Cadastro cancelado. Nada mudou.",
    );
    expect(h.finishRegistration).not.toHaveBeenCalled();
    expect(h.deletePasskey).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Nenhuma chave cadastrada. Senha, Google e MFA continuam disponíveis.")).toBeVisible());
  });
});
