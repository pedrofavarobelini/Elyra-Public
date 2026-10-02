import { cn } from "@/lib/utils";

type ProductArtworkProps = {
  avifSrc: string;
  webpSrc: string;
  width: number;
  height: number;
  className?: string;
  imageClassName?: string;
  eager?: boolean;
};

/** Original neutral decorative artwork. */
export function ProductArtwork({
  webpSrc,
  width,
  height,
  className,
  imageClassName,
  eager = false,
}: ProductArtworkProps) {
  return (
    <picture className={cn("block", className)}>
      {/* Dimensoes explicitas evitam CLS; alt vazio mantem a arte fora da arvore acessivel. */}
      <img
        src={webpSrc}
        alt=""
        aria-hidden="true"
        width={width}
        height={height}
        decoding="async"
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : "auto"}
        className={cn("block", imageClassName)}
      />
    </picture>
  );
}
