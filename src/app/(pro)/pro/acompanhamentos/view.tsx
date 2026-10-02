"use client";

import { ChevronRight, Search, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/journey/page-header";
import {
  BlockError,
  PersonCell,
  RelationshipStatusBadge,
} from "@/components/professional/portal-bits";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SHARING_SCOPE_LABEL } from "@/lib/contracts/sharing";
import {
  currentGrants,
  filterRelationships,
  formatDate,
  lastKnownChange,
  matchesFilter,
  RELATIONSHIP_FILTERS,
  type PortalRelationship,
  type RelationshipFilter,
  type RelationshipSort,
} from "@/lib/professional/portal";
import { cn } from "@/lib/utils";

const SORTS: Array<{ value: RelationshipSort; label: string }> = [
  { value: "recent", label: "Atualização mais recente" },
  { value: "name", label: "Nome" },
  { value: "since", label: "Início do vínculo" },
];


export function AcompanhamentosView({
  hasProfile,
  verified,
  relationships,
  available,
  now,
}: {
  now: number;
  hasProfile: boolean;
  verified: boolean;
  relationships: PortalRelationship[];
  available: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RelationshipFilter>("all");
  const [sort, setSort] = useState<RelationshipSort>("recent");
  // Pedidos legados pendentes vivem na Central de solicitacoes; aqui ficam os
  // vinculos que ja existiram de fato.
  const people = useMemo(
    () => relationships.filter((relationship) => relationship.status !== "pending"),
    [relationships],
  );
  const visible = useMemo(
    () => filterRelationships(people, { filter, query, sort }),
    [people, filter, query, sort],
  );

  if (!hasProfile) {
    return (
      <>
        <PageHeader title="Acompanhamentos" />
        <Card>
          <CardContent>
            <EmptyState
              title="Perfil profissional necessário"
              description="Cadastre seu registro antes de receber pessoas."
              action={
                <Button asChild>
                  <Link href="/area-profissional/cadastro">Cadastrar registro</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Acompanhamentos"
        description="Pessoas que criaram um vínculo com você. Cada uma decide o que compartilhar."
      />

      {/*
        Busca, filtro e ordenacao so existem quando ha o que organizar: com 0 ou
        1 pessoa o card de controles ficava mais alto que a propria lista no
        celular (W1, Design Pass final).
      */}
      {available && people.length > 1 ? (
        <Card className="mb-5 lg:mb-6">
          <CardContent className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <Label htmlFor="acompanhamentos-busca">Buscar por nome</Label>
              <div className="relative mt-1.5">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle"
                  aria-hidden="true"
                />
                <Input
                  id="acompanhamentos-busca"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="pl-9"
                  autoComplete="off"
                />
              </div>
            </div>
            <div
              role="group"
              aria-label="Filtrar por estado do vínculo"
              className="flex flex-wrap gap-2"
            >
              {RELATIONSHIP_FILTERS.map((option) => {
                const count = people.filter((r) => matchesFilter(r, option.value)).length;
                const pressed = filter === option.value;
                // Filtro que devolveria lista vazia nao e oferecido.
                if (count === 0 && option.value !== "all" && !pressed) return null;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => setFilter(option.value)}
                    className={cn(
                      "motion-press inline-flex min-h-11 items-center gap-1.5 rounded-pill border px-3.5 text-sm font-medium transition-colors",
                      pressed
                        ? "border-brand-300 bg-surface-brand text-brand-700"
                        : "border-line bg-surface text-ink-muted hover:bg-surface-muted",
                    )}
                  >
                    {option.label}
                    <span className="tabular-nums text-xs text-ink-subtle">{count}</span>
                  </button>
                );
              })}
            </div>
            <div className="lg:w-56">
              <Label htmlFor="acompanhamentos-ordem">Ordenar por</Label>
              <select
                id="acompanhamentos-ordem"
                value={sort}
                onChange={(event) => setSort(event.target.value as RelationshipSort)}
                className="mt-1.5 flex min-h-11 w-full rounded-control border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                {SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!available ? (
        <BlockError what="os acompanhamentos" />
      ) : people.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<Users />}
              title="Nenhum acompanhamento ainda"
              description={
                verified
                  ? "Um acompanhamento começa quando a pessoa aceita o seu convite. Nada é compartilhado só por isso."
                  : "Acompanhamentos começam depois da verificação do seu registro."
              }
              action={
                <Button asChild>
                  <Link href={verified ? "/pro/solicitacoes" : "/pro/perfil"}>
                    {verified ? "Gerar convite" : "Ver verificação"}
                  </Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <p className="sr-only" role="status" aria-live="polite">
            {visible.length === 1 ? "1 acompanhamento" : `${visible.length} acompanhamentos`}
          </p>
          {visible.length === 0 ? (
            <CardContent>
              <EmptyState
                size="compact"
                title="Nenhum acompanhamento com esses critérios"
                description={
                  query
                    ? "A busca só encontra nomes de vínculos ativos: pausados e encerrados não mostram o nome."
                    : "Troque o filtro para ver os outros vínculos."
                }
              />
            </CardContent>
          ) : (
            <ul className="flex flex-col divide-y divide-line" data-testid="acompanhamentos-lista">
              {visible.map((relationship) => {
                const grants = currentGrants(relationship, now);
                const scopes = [...new Set(grants.map((grant) => grant.scope))];
                return (
                  <li
                    key={relationship.id}
                    className="grid gap-3 p-4 sm:p-5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_auto] md:items-center"
                  >
                    <PersonCell
                      name={relationship.displayName}
                      caption={
                        relationship.acceptedAt
                          ? `Desde ${formatDate(relationship.acceptedAt)}`
                          : undefined
                      }
                    />
                    <div className="min-w-0">
                      <p className="text-sm text-ink">
                        {scopes.length === 0
                          ? "Nada compartilhado no momento"
                          : scopes.map((scope) => SHARING_SCOPE_LABEL[scope]).join(", ")}
                      </p>
                      <p className="text-xs text-ink-muted">
                        Última mudança em {formatDate(lastKnownChange(relationship))}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 md:justify-end">
                      <RelationshipStatusBadge status={relationship.status} />
                      {relationship.status === "active" ? (
                        <Button asChild variant="secondary" size="sm">
                          <Link href={`/pro/acompanhamentos/${relationship.clientUserId}`}>
                            Abrir dossiê
                            <ChevronRight aria-hidden="true" />
                          </Link>
                        </Button>
                      ) : (
                        <Button asChild variant="ghost" size="sm">
                          <Link href="/pro/vinculos">Ver vínculo</Link>
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
