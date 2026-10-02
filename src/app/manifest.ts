import type { MetadataRoute } from "next";


export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Elyra",
    short_name: "Elyra",
    description:
      "Acompanhamento emocional, hábitos e evolução com apoio de inteligência artificial não diagnóstica.",
    lang: "pt-BR",
    dir: "ltr",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      {
        src: "/placeholder/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/placeholder/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      /*
        O `maskable` e um arquivo separado, e nao o mesmo com outro `purpose`.
        Ele carrega a zona de seguranca de 80%: o sistema pode recortar em
        circulo ou squircle, e sem essa margem o recorte comeria a borda do
        simbolo.
      */
      {
        src: "/placeholder/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
