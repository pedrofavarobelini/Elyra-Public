import { NextResponse, type NextRequest } from "next/server";

import { STATIC_SECURITY_HEADERS } from "@/lib/security/headers";
import { canonicalLocalQaOrigin } from "@/lib/security/local-qa-origin";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const canonicalOrigin = canonicalLocalQaOrigin(
    request.headers,
    new URL(request.url).protocol,
  );
  if (canonicalOrigin) {
    const destination = new URL(canonicalOrigin);
    const navigation = request.method === "GET" || request.method === "HEAD";
    // Uma action de aba antiga nao deve reenviar corpo/cookies entre hosts.
    destination.pathname = navigation ? request.nextUrl.pathname : "/entrar";
    destination.search = navigation ? request.nextUrl.search : "";
    // Fetch/API em host errado nao recebe HTML 200: so documento ganha a ponte.
    const document =
      request.headers.get("sec-fetch-mode") === "navigate" ||
      (request.headers.get("accept") ?? "").includes("text/html");
    if (navigation && !document) {
      return new NextResponse(null, {
        status: 421,
        headers: bridgeHeaders(),
      });
    }
    if (!navigation) {
      return new NextResponse(null, {
        status: 303,
        headers: { ...bridgeHeaders(), Location: destination.toString() },
      });
    }
    // O adapter do Next reescreve um Location de mesmo host (127.0.0.1 ja
    // normalizado para localhost) como relativo, o que devolvia o navegador ao
    // proprio 127.0.0.1 em loop. Refresh + meta nao passam por essa reescrita.
    const href = escapeHtml(destination.toString());
    return new NextResponse(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${href}"><link rel="icon" href="data:,"><title>Elyra</title></head><body><p>Abrindo a Elyra em <a href="${href}">localhost</a>.</p></body></html>`,
      {
        status: 200,
        headers: {
          ...bridgeHeaders(),
          Refresh: `0;url=${destination.toString()}`,
          "Content-Type": "text/html; charset=utf-8",
        },
      },
    );
  }
  return updateSession(request);
}

// A ponte sai antes de `updateSession`, entao carrega os proprios headers: sem
// script, sem frame, sem formulario.
function bridgeHeaders(): Record<string, string> {
  return {
    ...STATIC_SECURITY_HEADERS,
    "Content-Security-Policy":
      "default-src 'none'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&#39;");
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
