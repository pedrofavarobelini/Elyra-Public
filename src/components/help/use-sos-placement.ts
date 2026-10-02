"use client";

import { useEffect, useState, type RefObject } from "react";



export type SosSide = "right" | "left";

const INTERACTIVE = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "label",
  "[role=button]",
  "[role=link]",
  "[role=slider]",
  "[role=switch]",
  "[role=tab]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=menuitem]",
  "[contenteditable=true]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Folga em volta do botao: um controle que encosta no canto por 1-3px tambem
 * conta como conflito (achado do E2E de sobreposicao, L-179).
 */
const PAD = 6;

type Box = { left: number; top: number; width: number; height: number };

/**
 * Conteudo que nao e controle mas nao pode ficar escondido: graficos, imagens
 * e avisos (`alert`, `status`, `note`). Decorativo (`aria-hidden`) nao conta.
 */
const PROTECTED_MEDIA = [
  "svg.recharts-surface",
  "canvas",
  "img",
  "video",
  "[role=img]",
  "[role=alert]",
  "[role=status]",
  "[role=note]",
].join(",");

function intersects(rect: { left: number; top: number; right: number; bottom: number }, area: Area) {
  return !(
    rect.right <= area.left ||
    rect.left >= area.right ||
    rect.bottom <= area.top ||
    rect.top >= area.bottom
  );
}

type Area = { left: number; top: number; right: number; bottom: number };

function padded(box: Box): Area {
  return {
    left: box.left - PAD,
    top: box.top - PAD,
    right: box.left + box.width + PAD,
    bottom: box.top + box.height + PAD,
  };
}

function isShown(element: Element) {
  if (element.closest("[data-elyra-sos], [aria-hidden=true]")) return false;
  return getComputedStyle(element).visibility !== "hidden";
}

/** Retangulos relevantes na faixa inferior da tela, coletados UMA vez por avaliacao. */
type Obstacles = { controls: Area[]; content: Area[] };

/**
 * O que existe na faixa onde o SOS pode ficar?
 *
 * Tres camadas, na ordem do mais barato ao mais caro:
 *
 * 1. **Controles** (L-179) — interseccao de retangulos, e nao
 *    `elementsFromPoint`: o Chrome nao devolve botoes `disabled` no hit testing.
 * 2. **Midia e avisos** — graficos, imagens, `alert`/`status`/`note`.
 * 3. **Texto** (homologacao humana, SOS_TEXT_OCCLUSION) — os retangulos das
 *    **linhas de texto reais** (`Range.getClientRects`), e nao a caixa do card.
 *
 * So leitura de layout; uma varredura serve a todos os candidatos.
 */
function collectObstacles(band: Area): Obstacles {
  const controls: Area[] = [];
  const content: Area[] = [];
  for (const element of document.querySelectorAll<HTMLElement>(INTERACTIVE)) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || !intersects(rect, band)) continue;
    if (element.closest("[data-elyra-sos]")) continue;
    if (getComputedStyle(element).visibility === "hidden") continue;
    // Grafico com camada de teclado (Recharts poe `tabindex` no svg) ocupa a
    // largura toda: e CONTEUDO (entra em PROTECTED_MEDIA), nao um botao que o
    // SOS impediria de tocar. Os dados tambem estao em "Ver os numeros".
    if (element.matches("svg.recharts-surface")) continue;
    controls.push(rect);
  }
  for (const element of document.querySelectorAll(PROTECTED_MEDIA)) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || !intersects(rect, band)) continue;
    if (isShown(element)) content.push(rect);
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let lastParent: Element | null = null;
  let parentInBand = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent) continue;
    if (parent !== lastParent) {
      lastParent = parent;
      const rect = parent.getBoundingClientRect();
      parentInBand = rect.width > 0 && rect.height > 0 && intersects(rect, band) && isShown(parent);
    }
    if (!parentInBand || !node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    for (const line of range.getClientRects()) {
      if (line.width > 0 && line.height > 0 && intersects(line, band)) content.push(line);
    }
  }
  return { controls, content };
}

const touches = (rects: Area[], box: Box) => {
  const area = padded(box);
  return rects.some((rect) => intersects(rect, area));
};


const LIFTS = [0, 24, 48];

export type SosOverlap = "none" | "content" | "control";

export function useSosPlacement(
  buttonRef: RefObject<HTMLButtonElement | null>,
  suspended: boolean,
): { side: SosSide; lift: number; blocked: boolean; overlap: SosOverlap; leftOffset: number } {
  const [state, setState] = useState<{ side: SosSide; lift: number; blocked: boolean; overlap: SosOverlap; leftOffset: number }>({
    side: "right",
    lift: 0,
    // Nasce VISIVEL no canto direito (SOS unico, 27/09): nunca espera medicao
    // para aparecer. Se precisar mudar de posicao, a troca e que e oculta.
    blocked: false,
    overlap: "none",
    leftOffset: 12,
  });

  useEffect(() => {
    if (suspended) return;
    let frame = 0;
    // Posicao **aplicada** no DOM (nao a desejada).
    let side: SosSide = "right";
    let lift = 0;
    let appliedLeft = -1;
    let moveTimer: number | undefined;
    let settleTimer: number | undefined;
    // Instante da ultima troca: entre trocas o botao fica PARADO e visivel.
    let lastMove = -Infinity;

    const reveal = (overlap: SosOverlap, leftOffset: number) =>
      setState((prev) =>
        prev.side === side && prev.lift === lift && !prev.blocked && prev.overlap === overlap && prev.leftOffset === leftOffset
          ? prev
          : { side, lift, blocked: false, overlap, leftOffset },
      );

    const evaluate = () => {
      frame = 0;
      const button = buttonRef.current;
      if (!button) return;
      if (!("getAnimations" in document)) {
        // Ambiente sem layout real (jsdom): nada a medir, o botao aparece.
        setState((prev) => (prev.blocked ? { ...prev, blocked: false } : prev));
        return;
      }
      // Com foco de teclado no proprio SOS, ele nao se move debaixo do foco.
      if (button.contains(document.activeElement)) {
        setState((prev) => (prev.blocked ? { ...prev, blocked: false } : prev));
        return;
      }
      // Com dialog/drawer aberto, o overlay ja cobre tudo; nada a decidir.
      if (document.querySelector("[data-elyra-dialog], [data-elyra-drawer]")) return;

      /*
        Entrada de pagina e listas em sequencia movem blocos por transform por
        algumas centenas de ms. Enquanto houver animacao finita no conteudo, a
        AVALIACAO espera (o botao continua visivel onde esta) e roda quando ela
        termina — por promessa, sem polling. Animacao infinita nao conta.
      */
      const main = document.getElementById("conteudo");
      const settling =
        main
          ? document.getAnimations().filter((animation) => {
              const target = (animation.effect as KeyframeEffect | null)?.target;
              const end = animation.effect?.getComputedTiming().endTime;
              return (
                animation.playState === "running" &&
                target instanceof Node &&
                main.contains(target) &&
                end !== Infinity
              );
            })
          : [];
      if (settling.length > 0) {
        void Promise.allSettled(settling.map((animation) => animation.finished)).then(schedule);
        return;
      }

      const current = button.getBoundingClientRect();
      if (current.width === 0) return;
      const desktop = window.innerWidth >= 1024;
      const margin = desktop ? 24 : 12;
      const mainLeft = main?.getBoundingClientRect().left ?? 0;
      const leftOffset = Math.round(Math.max(0, mainLeft) + margin);
      // Topo do canto sem degrau: desfaz o degrau aplicado agora.
      const baseTop = current.top + lift;
      const boxFor = (candidate: SosSide, step: number): Box => ({
        left: candidate === "right" ? window.innerWidth - margin - current.width : leftOffset,
        top: baseTop - step,
        width: current.width,
        height: current.height,
      });

      const ordered: Array<[SosSide, number]> = LIFTS.map((step) => ["right", step] as [SosSide, number]);
      // Histerese: a posicao atual vem primeiro, para nao pular durante a rolagem.
      const candidates: Array<[SosSide, number]> = [
        [side, lift],
        ...ordered.filter(([c, step]) => c !== side || step !== lift),
      ];
      const band: Area = {
        left: 0,
        top: baseTop - Math.max(...LIFTS) - PAD,
        right: window.innerWidth,
        bottom: baseTop + current.height + PAD,
      };
      const obstacles = collectObstacles(band);

      // 1) totalmente livre; 2) sem controle embaixo; 3) canto atual, visivel.
      let chosen: [SosSide, number] | undefined;
      let overlap: SosOverlap = "none";
      chosen = candidates.find(([c, step]) => {
        const box = boxFor(c, step);
        return !touches(obstacles.controls, box) && !touches(obstacles.content, box);
      });
      if (!chosen) {
        overlap = "content";
        chosen = candidates.find(([c, step]) => !touches(obstacles.controls, boxFor(c, step)));
      }
      if (!chosen) {
        overlap = "control";
        chosen = [side, lift];
      }
      const [nextSide, nextLift] = chosen;

      /*
        Trocar de posicao com o botao visivel conta como layout shift (CLS medido
        0.033 em Relatorios). A troca acontece **oculta** por 200 ms: esconde,
        espera o fade curto terminar, move e so entao a proxima avaliacao revela.
      */
      const moves = nextSide !== side || nextLift !== lift || (nextSide === "left" && leftOffset !== appliedLeft);
      /*
        Conteudo que cresce aos poucos (graficos animando, imagens) pediria uma
        troca atras da outra — e cada troca esconde o botao por 200 ms. Depois de
        uma troca ele fica PARADO e VISIVEL por 800 ms; so entao reavalia.
      */
      const sinceMove = performance.now() - lastMove;
      if (moves && sinceMove < 800) {
        const box = boxFor(side, lift);
        const here: SosOverlap = touches(obstacles.controls, box) ? "control" : touches(obstacles.content, box) ? "content" : "none";
        window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(schedule, 800 - sinceMove);
        reveal(here, appliedLeft >= 0 ? appliedLeft : leftOffset);
        return;
      }
      if (moves) {
        setState((prev) => (prev.blocked ? prev : { ...prev, blocked: true }));
        window.clearTimeout(moveTimer);
        moveTimer = window.setTimeout(() => {
          moveTimer = undefined;
          lastMove = performance.now();
          side = nextSide;
          lift = nextLift;
          appliedLeft = leftOffset;
          setState({ side, lift, blocked: true, overlap, leftOffset });
          schedule();
        }, 200);
        return;
      }
      if (moveTimer !== undefined) return; // movimento pendente: espera
      reveal(overlap, leftOffset);
    };

    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(evaluate);
    };

    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("focusout", schedule, true);
    document.addEventListener("toggle", schedule, true);
    document.addEventListener("transitionend", schedule, true);
    // Entrada de pagina (motion-page) move blocos por transform depois da
    // primeira avaliacao; reavaliar quando a animacao assenta.
    document.addEventListener("animationend", schedule, true);
    const content = document.getElementById("conteudo");
    const observer = new MutationObserver(schedule);
    if (content) observer.observe(content, { childList: true, subtree: true });
    // Reflow sem mutacao (fonte carregada, imagem, quebra de linha) muda o
    // tamanho do conteudo: o ResizeObserver avisa, sem polling.
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    if (content && resize) resize.observe(content);
    void document.fonts?.ready.then(schedule);

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("focusout", schedule, true);
      document.removeEventListener("toggle", schedule, true);
      document.removeEventListener("transitionend", schedule, true);
      document.removeEventListener("animationend", schedule, true);
      observer.disconnect();
      resize?.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.clearTimeout(moveTimer);
      window.clearTimeout(settleTimer);
    };
  }, [buttonRef, suspended]);

  return state;
}
