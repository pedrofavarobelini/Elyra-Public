import type { ReactNode } from "react";

import type { ContentBlock, ContentInline } from "@/lib/support-content/content-model";
import { matchAllowedSource } from "@/lib/support-content/policy";

/**
 * Renderiza a arvore segura do Markdown restrito (ADR-0033) como elementos
 * React. Nao existe caminho para HTML: todo texto vira no de texto escapado e
 * link so sai se a URL (ja validada no build) passar de novo pela allowlist.
 */
function Inline({ part }: { part: ContentInline }): ReactNode {
  if (part.type === "strong") return <strong className="font-semibold text-ink">{part.value}</strong>;
  if (part.type === "link") {
    if (!matchAllowedSource(part.href).ok) return <>{part.text}</>;
    return (
      <a href={part.href} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 underline underline-offset-4">
        {part.text}
        <span className="sr-only"> (abre em nova aba)</span>
      </a>
    );
  }
  return <>{part.value}</>;
}

export function ContentBody({ blocks }: { blocks: readonly ContentBlock[] }) {
  return (
    <div className="flex flex-col gap-4 text-base leading-relaxed text-ink">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === "h2") return <h2 key={key} className="mt-2 text-lg font-semibold tracking-tight text-ink">{block.text}</h2>;
        if (block.type === "h3") return <h3 key={key} className="text-base font-semibold text-ink">{block.text}</h3>;
        if (block.type === "ul") {
          return (
            <ul key={key} className="flex list-disc flex-col gap-1.5 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>
                  {item.map((part, partIndex) => (
                    <Inline key={partIndex} part={part} />
                  ))}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={key}>
            {block.inlines.map((part, partIndex) => (
              <Inline key={partIndex} part={part} />
            ))}
          </p>
        );
      })}
    </div>
  );
}
