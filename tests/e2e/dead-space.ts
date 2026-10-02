import type { Page } from "@playwright/test";


export async function measureDeadSpace(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main#conteudo") as HTMLElement;
    const mainBox = main.getBoundingClientRect();
    const style = getComputedStyle(main);
    const inner = mainBox.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const widest = Math.max(
      ...Array.from(main.children).map((child) => (child as HTMLElement).getBoundingClientRect().width),
    );
    const grids = Array.from(document.querySelectorAll<HTMLElement>("[data-layout='columns']")).map((grid) => {
      const columns = Array.from(grid.children) as HTMLElement[];
      const boxes = columns.map((column) => column.getBoundingClientRect());
      const sideBySide = boxes.length >= 2 && Math.abs(boxes[0]!.top - boxes[1]!.top) < 4 && boxes[1]!.left > boxes[0]!.right - 4;
      const bottoms = boxes.map((box) => box.bottom);
      const heights = boxes.map((box) => box.height);
      return {
        sideBySide,
        gap: sideBySide ? Math.max(...bottoms) - Math.min(...bottoms) : 0,
        shortRatio: sideBySide ? Math.min(...heights) / Math.max(...heights) : 1,
      };
    });
    return {
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      widthUse: widest / inner,
      grids,
    };
  });
}

/**
 * Palavras de rotulos `data-word-guard` partidas entre duas linhas.
 *
 * Sem dicionario de hifenizacao, `break-words` corta a palavra onde ela cabe
 * ("Acompanh/amentos"). Cada palavra precisa ocupar uma linha so; a prova e o
 * numero de linhas distintas dos retangulos de um `Range` sobre a palavra.
 */
export async function brokenGuardedWords(page: Page) {
  return page.$$eval("[data-word-guard]", (nodes) =>
    nodes.flatMap((node) => {
      const text = node.firstChild;
      if (!text || text.nodeType !== Node.TEXT_NODE) return [];
      const value = text.textContent ?? "";
      const broken: string[] = [];
      for (const match of value.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(text, match.index);
        range.setEnd(text, match.index + match[0].length);
        const lines = new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top)));
        if (lines.size > 1) broken.push(match[0]);
      }
      return broken;
    }),
  );
}
