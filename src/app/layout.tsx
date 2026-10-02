import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { HydrationMarker } from "@/components/layout/hydration-marker";
import { AccessibilityPreferencesProvider } from "@/components/accessibility/accessibility-preferences";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Elyra",
    template: "%s | Elyra",
  },
  description:
    "Acompanhamento emocional, hábitos e evolução com apoio de inteligência artificial não diagnóstica.",
  robots: { index: false, follow: false },
  // Sem isto o navegador pede /favicon.ico (inexistente): 404 e aba sem icone.
  icons: {
    icon: { url: "/placeholder/icon-192.png", type: "image/png", sizes: "192x192" },
    apple: { url: "/placeholder/icon-192.png", sizes: "192x192" },
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6fb" },
    { media: "(prefers-color-scheme: dark)", color: "#10121d" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-BR"
      className={inter.variable}
      data-elyra-theme="system"
      data-elyra-accent="violet"
      data-elyra-background="neutral"
      data-elyra-card-style="standard"
      data-elyra-text-size="default"
      data-elyra-contrast="default"
      data-elyra-motion="system"
      data-elyra-density="comfortable"
      data-elyra-card-shape="balanced"
      data-elyra-navigation="expanded"
      suppressHydrationWarning
    >
      <body>
        <HydrationMarker />
        <AccessibilityPreferencesProvider>{children}</AccessibilityPreferencesProvider>
      </body>
    </html>
  );
}
