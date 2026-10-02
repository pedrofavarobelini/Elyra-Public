import { ChevronLeft, ChevronRight, KeyRound, Search, UserRoundSearch } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/journey/page-header";
import { FilterDisclosure } from "./filter-disclosure";
import { DirectoryCard } from "@/components/professional/directory-card";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AREA_LABEL,
  DIRECTORY_AREAS,
  DIRECTORY_LANGUAGES,
  DIRECTORY_MODALITIES,
  directorySearchQuery,
  LANGUAGE_LABEL,
  MODALITY_LABEL,
  parseDirectorySearch,
  UF_CODES,
} from "@/lib/contracts/professional-directory";
import { requireConsentedUser } from "@/server/auth";
import {
  DirectoryRateLimitedError,
  searchProfessionalDirectory,
} from "@/server/services/professional-directory-service";

export const metadata: Metadata = { title: "Encontrar profissional" };

const SELECT =
  "mt-1.5 flex min-h-11 w-full rounded-control border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400";


export default async function ProfissionaisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, user } = await requireConsentedUser();
  const search = parseDirectorySearch(await searchParams);
  const filtered = Boolean(search.q || search.state || search.city || search.modality || search.area || search.language);

  let result: Awaited<ReturnType<typeof searchProfessionalDirectory>> | null = null;
  let failure: "rate" | "unavailable" | null = null;
  try {
    result = await searchProfessionalDirectory(supabase, user, search);
  } catch (error) {
    failure = error instanceof DirectoryRateLimitedError ? "rate" : "unavailable";
    if (!(error instanceof DirectoryRateLimitedError)) console.error("elyra.directory_search_unavailable");
  }

  return (
    <>
      <PageHeader
        title="Encontrar profissional"
        description="Psicólogas e psicólogos que escolheram aparecer aqui. Perfis reais mostram a conferência na fonte oficial; perfis de homologação aparecem marcados como DEMO. A lista mostra fatos: não avalia, não ranqueia e não recomenda."
      />

      {/*
        Dois caminhos para o MESMO vinculo: quem nao conhece um profissional
        busca aqui; quem ja conhece usa o codigo que recebeu (/convite).
      */}
      <nav aria-label="Como se conectar a um profissional" className="mb-5 grid gap-3 sm:grid-cols-2 lg:mb-6" data-testid="connect-paths">
        <a
          href="#busca-nome"
          className="motion-press flex min-h-11 items-start gap-3 rounded-card border border-line bg-surface p-4 text-left transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <UserRoundSearch aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand-700" />
          <span className="min-w-0">
            <span className="block font-medium text-ink">Buscar profissionais</span>
            <span className="mt-0.5 block text-sm text-ink-muted">Encontre profissionais disponíveis na Elyra.</span>
          </span>
        </a>
        <Link
          href="/convite?returnTo=%2Fprofissionais"
          className="motion-press flex min-h-11 items-start gap-3 rounded-card border border-line bg-surface p-4 text-left transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          data-testid="have-invite-code"
        >
          <KeyRound aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand-700" />
          <span className="min-w-0">
            <span className="block font-medium text-ink">Tenho um código de convite</span>
            <span className="mt-0.5 block text-sm text-ink-muted">
              Use o código enviado por um profissional que você já conhece.
            </span>
          </span>
        </Link>
      </nav>

      <Card className="mb-5 lg:mb-6">
        <CardContent>
          <form method="get" role="search" aria-label="Filtrar profissionais" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto] 2xl:items-end">
            <div className="min-w-0 sm:col-span-2 lg:col-span-2 2xl:col-span-1">
              <Label htmlFor="busca-nome">Nome</Label>
              <div className="relative mt-1.5">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
                <Input id="busca-nome" name="q" type="search" maxLength={60} defaultValue={search.q ?? ""} className="pl-9" autoComplete="off" />
              </div>
            </div>
            <div className="min-w-0">
              <Label htmlFor="busca-cidade">Cidade</Label>
              <Input id="busca-cidade" name="cidade" maxLength={60} defaultValue={search.city ?? ""} className="mt-1.5" autoComplete="address-level2" />
            </div>
            <FilterDisclosure
              activeCount={[search.state, search.modality, search.area, search.language].filter(Boolean).length}
            >
            <div className="min-w-0">
              <Label htmlFor="busca-uf">UF</Label>
              <select id="busca-uf" name="uf" defaultValue={search.state ?? ""} className={SELECT}>
                <option value="">Todas</option>
                {UF_CODES.map((uf) => (
                  <option key={uf} value={uf}>{uf}</option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <Label htmlFor="busca-modalidade">Modalidade</Label>
              <select id="busca-modalidade" name="modalidade" defaultValue={search.modality ?? ""} className={SELECT}>
                <option value="">Todas</option>
                {DIRECTORY_MODALITIES.map((modality) => (
                  <option key={modality} value={modality}>{MODALITY_LABEL[modality]}</option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <Label htmlFor="busca-area">Área declarada</Label>
              <select id="busca-area" name="area" defaultValue={search.area ?? ""} className={SELECT}>
                <option value="">Todas</option>
                {DIRECTORY_AREAS.map((area) => (
                  <option key={area} value={area}>{AREA_LABEL[area]}</option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <Label htmlFor="busca-idioma">Idioma</Label>
              <select id="busca-idioma" name="idioma" defaultValue={search.language ?? ""} className={SELECT}>
                <option value="">Todos</option>
                {DIRECTORY_LANGUAGES.map((language) => (
                  <option key={language} value={language}>{LANGUAGE_LABEL[language]}</option>
                ))}
              </select>
            </div>
            </FilterDisclosure>
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-1">
              <Button type="submit" className="w-full 2xl:w-auto">Buscar</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
        <p data-testid="directory-order">
          Ordem alfabética{result ? ` · página ${result.page}` : ""}
        </p>
        {filtered ? (
          <Link href="/profissionais" className="font-medium text-brand-700 hover:underline">
            Limpar filtros
          </Link>
        ) : null}
      </div>

      {failure ? (
        <Card>
          <CardContent>
            <EmptyState
              size="compact"
              title={failure === "rate" ? "Muitas consultas seguidas" : "Descoberta indisponível agora"}
              description={
                failure === "rate"
                  ? "Aguarde um minuto e tente de novo. O limite existe para proteger quem aparece aqui."
                  : "Não foi possível carregar a lista. Tente novamente em instantes."
              }
            />
          </CardContent>
        </Card>
      ) : result && result.results.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              size="compact"
              icon={<UserRoundSearch />}
              title={filtered || result.page > 1 ? "Nenhum perfil com esses filtros" : "Ainda não há perfis publicados"}
              description={
                filtered || result.page > 1
                  ? "Troque ou limpe os filtros para ver outros perfis."
                  : "Profissionais aparecem aqui quando têm o registro conferido e escolhem publicar o perfil."
              }
              action={
                filtered || result.page > 1 ? (
                  <Button asChild variant="secondary">
                    <Link href="/profissionais">Limpar filtros</Link>
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      ) : result ? (
        <>
          <ul className="grid items-start gap-4 md:grid-cols-2 lg:gap-5 2xl:grid-cols-3" data-testid="directory-results">
            {result.results.map((profile) => (
              <li key={profile.slug}>
                <DirectoryCard profile={profile} />
              </li>
            ))}
          </ul>
          {result.page > 1 || result.hasMore ? (
            <nav aria-label="Paginação" className="mt-5 flex items-center justify-between gap-3">
              {result.page > 1 ? (
                <Button asChild variant="secondary">
                  <Link href={{ pathname: "/profissionais", query: directorySearchQuery(search, { page: result.page - 1 }) }}>
                    <ChevronLeft aria-hidden="true" />
                    Anterior
                  </Link>
                </Button>
              ) : (
                <span />
              )}
              <p className="text-sm text-ink-muted" aria-current="page">Página {result.page}</p>
              {result.hasMore ? (
                <Button asChild variant="secondary">
                  <Link href={{ pathname: "/profissionais", query: directorySearchQuery(search, { page: result.page + 1 }) }}>
                    Próxima
                    <ChevronRight aria-hidden="true" />
                  </Link>
                </Button>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      ) : null}

    </>
  );
}
