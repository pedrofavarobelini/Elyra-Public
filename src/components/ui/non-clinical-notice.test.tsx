import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  NON_CLINICAL_MESSAGES,
  NonClinicalNotice,
} from "./non-clinical-notice";

describe("NonClinicalNotice", () => {
  it.each(Object.keys(NON_CLINICAL_MESSAGES) as Array<
    keyof typeof NON_CLINICAL_MESSAGES
  >)("renderiza o aviso do contexto %s", (context) => {
    render(<NonClinicalNotice context={context} />);
    expect(screen.getByRole("note")).toHaveTextContent(
      NON_CLINICAL_MESSAGES[context],
    );
  });

  it("nenhuma mensagem afirma diagnostico", () => {
    for (const message of Object.values(NON_CLINICAL_MESSAGES)) {
      expect(message.toLowerCase()).toMatch(/não (fornece|representa|determina|é um)/);
    }
  });
});
