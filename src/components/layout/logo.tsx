import Image from "next/image";

import { cn } from "@/lib/utils";




const LOGO = { src: "/placeholder/logo.svg", width: 300, height: 96 } as const;
const SYMBOL = { src: "/placeholder/symbol.svg", width: 64, height: 64 } as const;

interface LogoProps {
  className?: string;
  variant?: "full" | "symbol";
  priority?: boolean;
}

export function Logo({
  className,
  variant = "full",
  priority = false,
}: LogoProps) {
  const asset = variant === "symbol" ? SYMBOL : LOGO;

  return (
    <Image
      src={asset.src}
      unoptimized
      width={asset.width}
      height={asset.height}
      priority={priority}
      // A marca ja nomeia o produto; quem lÃª com leitor de tela recebe o nome
      // pelo `aria-label` do link que a envolve. Alt vazio evita a duplicacao.
      alt=""
      aria-hidden="true"
      className={cn(
        "w-auto select-none",
        variant === "symbol" ? "h-8" : "h-9 sm:h-10",
        className,
      )}
    />
  );
}
