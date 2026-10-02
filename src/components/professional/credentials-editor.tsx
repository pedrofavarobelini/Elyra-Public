"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CREDENTIAL_COPY, TRUST_STATE_LABEL, type CredentialKind } from "@/lib/contracts/professional-onboarding";

export interface EditableCredential {
  id: string;
  kind: CredentialKind;
  title: string;
  institution: string;
  startYear: number | null;
  endYear: number | null;
  expiresOn: string | null;
  trustState: "declared" | "verified";
}

async function send(method: string, url: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const payload = (await response.json().catch(() => ({}))) as { data?: unknown; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Não foi possível salvar agora. Tente de novo.");
  return payload.data;
}

function yearOrNull(raw: string) {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * Formacao, experiencia ou certificacoes declaradas (F2/F6). Mesmo editor no
 * cadastro e no Perfil profissional. Editar item verificado o devolve a
 * "declarado" (regra do banco) — a tela avisa antes.
 */
export function CredentialsEditor({
  kind,
  initial,
  onChange,
}: {
  kind: CredentialKind;
  initial: EditableCredential[];
  onChange?: (items: EditableCredential[], editing: boolean) => void;
}) {
  const copy = CREDENTIAL_COPY[kind];
  const router = useRouter();
  const [items, setItemsState] = useState(initial);
  const [editing, setEditingState] = useState<string | "new" | null>(initial.length === 0 ? "new" : null);
  const [error, setError] = useState<string | null>(null);

  function update(nextItems: EditableCredential[], nextEditing: string | "new" | null) {
    setItemsState(nextItems);
    setEditingState(nextEditing);
    onChange?.(nextItems, nextEditing !== null);
  }

  async function persist(form: HTMLFormElement, id: string | "new") {
    const data = new FormData(form);
    const body = {
      kind,
      title: String(data.get("title") ?? ""),
      institution: String(data.get("institution") ?? ""),
      startYear: yearOrNull(String(data.get("startYear") ?? "")),
      endYear: yearOrNull(String(data.get("endYear") ?? "")),
      expiresOn: kind === "certification" && data.get("expiresOn") ? String(data.get("expiresOn")) : null,
    };
    setError(null);
    try {
      const saved = (await send(
        id === "new" ? "POST" : "PATCH",
        id === "new" ? "/api/professional/credentials" : `/api/professional/credentials?id=${id}`,
        body,
      )) as { id: string; trust_state: "declared" | "verified" };
      const item: EditableCredential = { ...body, id: saved.id, trustState: saved.trust_state };
      update(id === "new" ? [...items, item] : items.map((row) => (row.id === id ? item : row)), null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar.");
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await send("DELETE", `/api/professional/credentials?id=${id}`);
      update(items.filter((row) => row.id !== id), editing);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível remover.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 && editing !== "new" ? <p className="text-sm text-ink-muted">{copy.empty}</p> : null}
      <ul className="flex flex-col gap-2" data-testid={`credentials-${kind}`}>
        {items.map((item) =>
          editing === item.id ? (
            <li key={item.id}>
              <CredentialForm kind={kind} initial={item} onCancel={() => update(items, null)} onSubmit={(form) => persist(form, item.id)} />
            </li>
          ) : (
            <li key={item.id} className="flex items-start gap-3 rounded-control border border-line px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{item.title}</p>
                <p className="text-sm text-ink-muted">
                  {item.institution}
                  {item.startYear ? ` · ${item.startYear}${item.endYear ? `–${item.endYear}` : "–atual"}` : ""}
                </p>
                <Badge className="mt-1.5" tone={item.trustState === "verified" ? "identity" : "neutral"}>
                  {TRUST_STATE_LABEL[item.trustState]}
                </Badge>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label={`Editar ${item.title}`} onClick={() => update(items, item.id)}>
                <Pencil className="size-4" aria-hidden="true" />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remover ${item.title}`} onClick={() => remove(item.id)}>
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ),
        )}
      </ul>
      {editing === "new" ? (
        <CredentialForm kind={kind} onCancel={items.length ? () => update(items, null) : undefined} onSubmit={(form) => persist(form, "new")} />
      ) : (
        <Button type="button" variant="secondary" className="self-start" onClick={() => update(items, "new")}>
          <Plus className="size-4" aria-hidden="true" />
          {copy.add}
        </Button>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CredentialForm({
  kind,
  initial,
  onSubmit,
  onCancel,
}: {
  kind: CredentialKind;
  initial?: EditableCredential;
  onSubmit: (form: HTMLFormElement) => void;
  onCancel?: () => void;
}) {
  const copy = CREDENTIAL_COPY[kind];
  const prefix = `credential-${kind}-${initial?.id ?? "new"}`;
  return (
    <form
      className="flex flex-col gap-3 rounded-control border border-brand-200 bg-surface-brand/40 p-3.5"
      data-testid={`credential-form-${kind}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(event.currentTarget);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${prefix}-title`}>{copy.title}</Label>
          <Input id={`${prefix}-title`} name="title" defaultValue={initial?.title} minLength={2} maxLength={120} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${prefix}-institution`}>{copy.institution}</Label>
          <Input
            id={`${prefix}-institution`}
            name="institution"
            defaultValue={initial?.institution}
            minLength={2}
            maxLength={120}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${prefix}-start`}>Ano de início (opcional)</Label>
          <Input id={`${prefix}-start`} name="startYear" inputMode="numeric" pattern="[0-9]{4}" defaultValue={initial?.startYear ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${prefix}-end`}>Ano de conclusão (vazio = atual)</Label>
          <Input id={`${prefix}-end`} name="endYear" inputMode="numeric" pattern="[0-9]{4}" defaultValue={initial?.endYear ?? ""} />
        </div>
        {kind === "certification" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${prefix}-expires`}>Válida até (opcional)</Label>
            <Input id={`${prefix}-expires`} name="expiresOn" type="date" defaultValue={initial?.expiresOn ?? ""} />
          </div>
        ) : null}
      </div>
      {initial?.trustState === "verified" ? (
        <p className="text-xs text-attention">Alterar um item verificado faz ele voltar a “declarado” até nova conferência.</p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit">Salvar item</Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}
