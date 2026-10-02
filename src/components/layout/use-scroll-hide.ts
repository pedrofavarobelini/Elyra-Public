"use client";

import { useEffect, useState } from "react";

/**
 * Header que recolhe ao rolar para baixo e volta ao rolar para cima (R2).
 *
 * So abaixo de `lg` — no desktop a barra nao e fixa. Previsivel de proposito:
 *
 * - perto do topo (< 96px) ele sempre aparece;
 * - so esconde depois de 12px seguidos para baixo, e volta com 12px para cima
 *   (histerese: tremida do dedo nao faz a barra piscar);
 * - nunca esconde com foco dentro dele nem com drawer/dialog aberto.
 *
 * So `transform`: a barra continua ocupando o mesmo espaco no fluxo, entao
 * recolher nao desloca conteudo (CLS 0). Reduced motion vira troca instantanea
 * pela regra global.
 */
export function useScrollHide(headerId: string): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 64rem)");
    let lastY = window.scrollY;
    let travel = 0;
    let frame = 0;

    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const delta = y - lastY;
      lastY = y;

      if (desktop.matches || y < 96) {
        travel = 0;
        setHidden(false);
        return;
      }
      const header = document.getElementById(headerId);
      const blocked =
        (header !== null && header.contains(document.activeElement)) ||
        document.querySelector("[data-elyra-drawer], [data-elyra-dialog]") !== null;
      if (blocked) {
        travel = 0;
        setHidden(false);
        return;
      }

      travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
      if (travel > 12) setHidden(true);
      else if (travel < -12) setHidden(false);
    };

    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };

    // Teclado: foco que entra no header o traz de volta na hora.
    const onFocusIn = (event: FocusEvent) => {
      const header = document.getElementById(headerId);
      if (header && event.target instanceof Node && header.contains(event.target)) {
        travel = 0;
        setHidden(false);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("focusin", onFocusIn);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [headerId]);

  return hidden;
}
