import { SearchX } from "lucide-react";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";


export default function AppNotFound() {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
          <span
            className="flex size-12 items-center justify-center rounded-full bg-attention-soft"
            aria-hidden="true"
          >
            <SearchX className="size-6 text-attention" />
          </span>

          <div className="flex flex-col gap-2">
            <h1 className="text-lg font-semibold text-ink">
              Não encontramos esta página
            </h1>
            <p className="text-sm text-ink-muted">
              O endereço pode estar incorreto, o registro pode ter sido removido
              ou pertencer a outra conta. Se você recebeu este link, confira se
              entrou com a conta certa.
            </p>
          </div>

          <Link
            href="/dashboard"
            className="text-sm font-medium text-brand-600 hover:underline"
          >
            Ir para o painel
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
