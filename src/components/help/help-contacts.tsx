import { ExternalLink, Phone } from "lucide-react";

import { HELP_GROUPS } from "@/lib/contracts/help";

/**
 * Lista estatica de contatos de ajuda. Sem hooks e sem `use client`: renderiza
 * igual no painel SOS e na pagina offline servida do cache.
 */
export function HelpContacts() {
  return (
    <div className="flex flex-col gap-4">
      {HELP_GROUPS.map((group) => (
        <section key={group.id} aria-labelledby={`sos-${group.id}`}>
          <h3 id={`sos-${group.id}`} className="text-sm font-semibold text-ink">
            {group.title}
          </h3>
          <p className="text-xs text-ink-muted">{group.description}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {group.contacts.map((contact) => {
              const external = contact.href.startsWith("https://");
              return (
                <li key={contact.id}>
                  <a
                    href={contact.href}
                    {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className="motion-press flex min-h-14 items-center gap-3 rounded-control border border-line bg-surface px-3 py-2 transition-colors hover:border-sos/40 hover:bg-sos-soft"
                  >
                    <span
                      aria-hidden="true"
                      className="inline-flex size-9 shrink-0 items-center justify-center rounded-pill bg-sos-soft text-sos"
                    >
                      {external ? <ExternalLink className="size-4" /> : <Phone className="size-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink">{contact.name}</span>
                      <span className="block text-xs text-ink-muted">{contact.detail}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-sos-strong">
                      {contact.action}
                      {external ? <span className="sr-only"> (abre em nova aba)</span> : null}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
