"use client";

import { useEffect } from "react";


export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sem conteudo da pessoa: apenas identificador tecnico, como manda a
    // politica de logs da V1.
    console.error("elyra.global_error", error.digest ?? error.name);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          background: "#f7f7fb",
          color: "#1b1b24",
        }}
      >
        <main style={{ maxWidth: 460, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 12px" }}>
            Não foi possível carregar a Elyra
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.55, margin: "0 0 8px" }}>
            A conexão falhou antes de a página ficar pronta. Seus registros
            continuam salvos.
          </p>
          <p style={{ fontSize: 13, lineHeight: 1.55, margin: "0 0 20px", opacity: 0.7 }}>
            Tente de novo. Se continuar, verifique sua conexão.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              cursor: "pointer",
              border: "none",
              borderRadius: 10,
              padding: "11px 22px",
              fontSize: 15,
              fontWeight: 500,
              color: "#fff",
              background: "#1c5f6b",
            }}
          >
            Tentar novamente
          </button>
        </main>
      </body>
    </html>
  );
}
