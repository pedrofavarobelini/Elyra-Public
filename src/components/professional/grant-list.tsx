import { Badge } from "@/components/ui/badge";
import { describeDataWindow, SHARING_SCOPE_LABEL, type SharingScope } from "@/lib/contracts/sharing";
import { formatDate } from "@/lib/professional/portal";

export interface GrantRowData {
  id: string;
  scope: SharingScope;
  journalEntryId: string | null;
  status: string;
  grantedAt: string | null;
  validFrom: string | null;
  validUntil: string | null;
  revokedAt: string | null;
  dataFrom: string | null;
  dataTo: string | null;
}

function state(grant: GrantRowData, now: number, suspended: boolean) {
  if (grant.status === "revoked" || grant.revokedAt) return { label: "Revogado", tone: "neutral" as const };
  if (grant.validUntil && Date.parse(grant.validUntil) <= now) return { label: "Expirado", tone: "neutral" as const };
  // Vinculo pausado: o grant existe, mas nenhum acesso vale (PRO-3). "Vigente"
  // em verde contradizia o aviso logo abaixo.
  if (suspended) return { label: "Suspenso", tone: "attention" as const };
  if (grant.validFrom && Date.parse(grant.validFrom) > now) return { label: "Ainda não começou", tone: "brand" as const };
  return { label: "Vigente", tone: "positive" as const };
}

function validity(grant: GrantRowData) {
  const from = grant.validFrom || grant.grantedAt ? formatDate((grant.validFrom ?? grant.grantedAt)!) : "Vigente";
  const until = grant.revokedAt
    ? `${formatDate(grant.revokedAt)} (revogado)`
    : grant.validUntil
      ? formatDate(grant.validUntil)
      : "a pessoa revogar";
  return `${from} até ${until}`;
}

export interface GrantGroup {
  key: string;
  scopes: string[];
  access: string;
  state: ReturnType<typeof state>;
  validity: string;
  period: string;
}

/**
 * Junta grants que mostrariam exatamente as mesmas celulas.
 *
 * Sete escopos concedidos no mesmo instante repetiam sete vezes "Vigente / ate
 * a pessoa revogar / Todo o historico" no celular (W2). A chave de grupo e o
 * texto de cada celula exibida - estado, validade, periodo e tipo de acesso -,
 * entao qualquer diferenca visivel mantem linhas separadas: agrupar nunca
 * esconde uma autorizacao diferente. A ordem e a da primeira ocorrencia.
 */
export function groupGrants(grants: GrantRowData[], now: number, suspended = false): GrantGroup[] {
  const groups = new Map<string, GrantGroup & { counts: Map<string, number> }>();
  for (const grant of grants) {
    const current = state(grant, now, suspended);
    const access = grant.journalEntryId ? "Uma entrada específica · leitura" : "Leitura";
    const row = {
      access,
      state: current,
      validity: validity(grant),
      period: describeDataWindow(grant.dataFrom, grant.dataTo),
    };
    const key = [row.access, row.state.label, row.validity, row.period].join("|");
    const label = SHARING_SCOPE_LABEL[grant.scope] ?? grant.scope;
    const group = groups.get(key) ?? { key, scopes: [] as string[], counts: new Map<string, number>(), ...row };
    if (!group.counts.has(label)) group.scopes.push(label);
    group.counts.set(label, (group.counts.get(label) ?? 0) + 1);
    groups.set(key, group);
  }
  // Duas entradas de diario distintas nao viram "uma": a contagem fica visivel.
  return [...groups.values()].map(({ counts, ...group }) => ({
    ...group,
    access: [...counts.values()].some((count) => count > 1) && group.access.startsWith("Uma entrada")
      ? "Entradas específicas · leitura"
      : group.access,
    scopes: group.scopes.map((label) => (counts.get(label)! > 1 ? `${label} (${counts.get(label)})` : label)),
  }));
}


export function GrantList({
  grants,
  now,
  label,
  suspended = false,
}: {
  grants: GrantRowData[];
  now: number;
  label: string;
  /** Vinculo pausado pela pessoa: nenhum grant vale enquanto durar a pausa. */
  suspended?: boolean;
}) {
  const groups = groupGrants(grants, now, suspended);
  return (
    <div role="list" aria-label={label} className="flex flex-col divide-y divide-line" data-testid="grants-list">
      <div
        aria-hidden="true"
        className="hidden pb-2 text-xs text-ink-muted md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,1.4fr)] md:gap-3"
      >
        <span>Escopo</span>
        <span>Estado</span>
        <span>Validade</span>
        <span>Período dos registros</span>
      </div>
      {groups.map((group) => (
        <div role="listitem" key={group.key}>
          <dl
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 py-2.5 text-sm md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,1.4fr)] md:items-center md:gap-3"
          >
            <dt className="sr-only">{group.scopes.length === 1 ? "Escopo" : "Escopos"}</dt>
            <dd className="col-span-2 font-medium text-ink md:col-span-1">
              {group.scopes.join(", ")}
              <span className="block text-xs font-normal text-ink-muted">{group.access}</span>
            </dd>
            <dt className="text-xs text-ink-muted md:sr-only">Estado</dt>
            <dd>
              <Badge tone={group.state.tone}>{group.state.label}</Badge>
            </dd>
            <dt className="text-xs text-ink-muted md:sr-only">Validade</dt>
            <dd className="text-ink-muted">{group.validity}</dd>
            <dt className="text-xs text-ink-muted md:sr-only">Período</dt>
            <dd className="text-ink-muted">{group.period}</dd>
          </dl>
        </div>
      ))}
    </div>
  );
}
