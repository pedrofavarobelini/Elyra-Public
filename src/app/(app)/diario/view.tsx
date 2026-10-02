"use client";

import {
  BookOpen,
  Lock,
  NotebookPen,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { PageHeader } from "@/components/journey/page-header";
import { HISTORY_DOMAINS, OlderHistoryNotice } from "@/components/journey/older-history";
import { EmptyState } from "@/components/states";
import { PendingSyncBadge } from "@/components/offline/pending-sync-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  customJournalTagInputSchema,
  daysUntilPurge,
  type JournalEntryInput,
  type JournalStatus,
} from "@/lib/contracts/journal";
import { cn } from "@/lib/utils";
import { useMockStore } from "@/mocks/store";

const AUTOSAVE_DEBOUNCE_MS = 800;

export function JournalView() {
  const {
    journal,
    tags,
    saveJournal,
    addCustomTag,
    trashJournal,
    restoreJournal,
    purgeJournal,
    isPendingSync,
  } = useMockStore();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [customTag, setCustomTag] = useState("");
  const [autosaveState, setAutosaveState] =
    useState<"idle" | "saving" | "saved">("idle");
  const [purgeTarget, setPurgeTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftIdRef = useRef<string | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const autosaveSequence = useRef(0);
  const suppressAutosave = useRef(false);

  const ensureDraftId = () => {
    if (!draftIdRef.current) {
      draftIdRef.current = crypto.randomUUID();
      setDraftId(draftIdRef.current);
    }
    return draftIdRef.current;
  };

  const queueSave = useCallback(
    (input: JournalEntryInput, id: string, status: JournalStatus) => {
      const run = saveQueue.current.then(
        () => saveJournal(input, { id, status }),
        () => saveJournal(input, { id, status }),
      );
      saveQueue.current = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    [saveJournal],
  );

  const markSaving = (nextTitle: string, nextContent: string) => {
    const hasText = nextTitle.trim() !== "" || nextContent.trim() !== "";
    if (hasText) ensureDraftId();
    setAutosaveState(hasText ? "saving" : "idle");
    setError(null);
  };

  // O UUID nasce no primeiro gesto e permanece estavel. A fila serial impede
  // que um autosave atrasado reverta um `saved` posterior para `draft`.
  useEffect(() => {
    if (suppressAutosave.current) {
      suppressAutosave.current = false;
      return;
    }
    if (title.trim() === "" && content.trim() === "") return;
    const id = draftIdRef.current;
    if (!id) return;

    const sequence = ++autosaveSequence.current;
    const handle = setTimeout(() => {
      void queueSave(
        { title, content, tagIds: selectedTags },
        id,
        "draft",
      )
        .then(() => {
          if (sequence === autosaveSequence.current) setAutosaveState("saved");
        })
        .catch((caught) => {
          if (sequence !== autosaveSequence.current) return;
          setAutosaveState("idle");
          setError(
            caught instanceof Error
              ? caught.message
              : "Não foi possível salvar o rascunho.",
          );
        });
    }, AUTOSAVE_DEBOUNCE_MS);

    timer.current = handle;
    return () => clearTimeout(handle);
  }, [title, content, selectedTags, queueSave]);

  const active = journal.filter((entry) => entry.trashedAt === null);
  const trashed = journal.filter((entry) => entry.trashedAt !== null);

  const resetEditor = () => {
    suppressAutosave.current = true;
    draftIdRef.current = null;
    setDraftId(null);
    setTitle("");
    setContent("");
    setSelectedTags([]);
    setAutosaveState("idle");
  };

  const commit = async () => {
    if (title.trim() === "" && content.trim() === "") return;
    if (timer.current) clearTimeout(timer.current);
    const id = ensureDraftId();
    const sequence = ++autosaveSequence.current;
    setBusy(true);
    setAutosaveState("saving");
    setError(null);
    try {
      await queueSave({ title, content, tagIds: selectedTags }, id, "saved");
      if (sequence === autosaveSequence.current) resetEditor();
    } catch (caught) {
      setAutosaveState("idle");
      setError(
        caught instanceof Error ? caught.message : "Não foi possível salvar.",
      );
    } finally {
      setBusy(false);
    }
  };

  const edit = (entry: (typeof journal)[number]) => {
    if (timer.current) clearTimeout(timer.current);
    suppressAutosave.current = true;
    autosaveSequence.current += 1;
    draftIdRef.current = entry.id;
    setDraftId(entry.id);
    setTitle(entry.title);
    setContent(entry.content);
    setSelectedTags(entry.tagIds);
    setAutosaveState("idle");
    setError(null);
  };

  const runEntryAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Não foi possível concluir.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };


  const termo = search.trim().toLocaleLowerCase("pt-BR");
  const tagLabel = (id: string) => tags.find((tag) => tag.id === id)?.label ?? "";
  const visiveis = termo
    ? active.filter((entry) =>
        [entry.title, entry.content, ...entry.tagIds.map(tagLabel)]
          .join(" ")
          .toLocaleLowerCase("pt-BR")
          .includes(termo),
      )
    : active;
  const editing = draftId !== null && journal.some((entry) => entry.id === draftId);
  const wordCount = content.trim() === "" ? 0 : content.trim().split(/\s+/).length;
  const todayLabel = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <>
      <PageHeader
        title="Diário"
        description="Suas anotações são privadas por padrão."
        meta={
          <Badge tone="identity">
            <Lock className="size-3" aria-hidden="true" />
            Privado
          </Badge>
        }
      />

      <OlderHistoryNotice domains={HISTORY_DOMAINS.journal} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(20rem,1fr)]

 2xl:grid-cols-[minmax(0,1.7fr)_minmax(24rem,1fr)]">
        {/* Editor: superficie editorial, sem aparencia de formulario CRUD. */}
        <Card variant="hero" className="flex flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <NotebookPen className="size-4 text-brand-600" aria-hidden="true" />
              {editing ? "Editando anotação" : "Nova anotação"}
            </p>
            <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "size-2 rounded-pill transition-colors duration-[var(--duration-normal)]",
                autosaveState === "saving"
                  ? "animate-pulse bg-attention"
                  : autosaveState === "saved"
                    ? "motion-pop bg-positive"
                    : "bg-transparent",
              )}
            />
            <span
              data-testid="autosave-status"
              data-draft-id={draftId ?? undefined}
              className="text-xs text-ink-subtle"
              aria-live="polite"
            >
              {autosaveState === "saving"
                ? "Salvando rascunho..."
                : autosaveState === "saved"
                  ? draftId && isPendingSync(draftId)
                    ? "Rascunho guardado neste aparelho"
                    : "Rascunho salvo"
                  : ""}
            </span>
            </span>
          </div>

          <div className="flex flex-1 flex-col gap-3 px-4 pb-4 pt-5 sm:px-8 sm:pb-6 sm:pt-7">
            <p className="text-xs font-medium first-letter:uppercase text-brand-700" suppressHydrationWarning>
              {todayLabel}
            </p>
            <div className="flex flex-col">
              <Label htmlFor="j-title" className="sr-only">
                Título
              </Label>
              <Input
                id="j-title"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  markSaving(event.target.value, content);
                }}
                placeholder="Título (opcional)"
                maxLength={120}
                className="h-auto min-h-11 border-transparent bg-transparent px-0 py-1 text-2xl font-semibold tracking-tight shadow-none placeholder:text-ink-subtle/70 hover:border-transparent focus-visible:border-transparent focus-visible:shadow-none lg:text-2xl"
              />
            </div>

            <div className="flex flex-1 flex-col">
              <Label htmlFor="j-content" className="sr-only">
                Anotação
              </Label>
              <Textarea
                id="j-content"
                value={content}
                onChange={(event) => {
                  setContent(event.target.value);
                  markSaving(title, event.target.value);
                }}
                placeholder="Escreva livremente. Ninguém além de você lê isto."
                className="min-h-64 flex-1 resize-none break-words border-transparent [overflow-wrap:anywhere] lg:resize-y bg-transparent px-0 text-[1.0625rem] leading-8 text-ink shadow-none placeholder:text-ink-subtle/70 hover:border-transparent focus-visible:border-transparent focus-visible:shadow-none lg:min-h-96 lg:text-base lg:leading-8"
              />
              <p className="mt-1 text-right text-xs tabular-nums text-ink-subtle">
                {wordCount === 1 ? "1 palavra" : `${wordCount} palavras`}
              </p>
            </div>

            <div className="border-t border-line pt-4">
              <p className="mb-2 text-xs font-medium text-ink-subtle">Tags</p>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => {
                  const on = selectedTags.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setSelectedTags((previous) =>
                          previous.includes(tag.id)
                            ? previous.filter((id) => id !== tag.id)
                            : [...previous, tag.id],
                        );
                        markSaving(title, content);
                      }}
                      className={cn(
                        "min-h-11 rounded-pill border px-3.5 text-sm transition-colors duration-150 lg:min-h-9",
                        on
                          ? "border-brand-300 bg-brand-100 font-medium text-brand-700"
                          : "border-line-strong bg-surface text-ink-muted hover:border-brand-200 hover:bg-surface-brand",
                      )}
                    >
                      {tag.label}
                      {tag.origin === "custom" ? " (sua)" : ""}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex min-w-0 max-w-md gap-2">
                <Input
                  aria-label="Criar tag própria"
                  value={customTag}
                  onChange={(event) => setCustomTag(event.target.value)}
                  placeholder="Nova tag"
                  maxLength={30}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  className="shrink-0"
                  onClick={async () => {
                    const parsed = customJournalTagInputSchema.safeParse({
                      label: customTag,
                    });
                    if (!parsed.success) {
                      setError(parsed.error.issues[0]?.message ?? "Tag inválida.");
                      return;
                    }
                    setBusy(true);
                    setError(null);
                    try {
                      const created = await addCustomTag(parsed.data.label);
                      setSelectedTags((previous) =>
                        previous.includes(created.id)
                          ? previous
                          : [...previous, created.id],
                      );
                      setCustomTag("");
                      markSaving(title, content);
                    } catch (caught) {
                      setError(
                        caught instanceof Error
                          ? caught.message
                          : "Não foi possível criar a tag.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Plus aria-hidden="true" />
                  Adicionar tag
                </Button>
              </div>
            </div>

            {error ? (
              <p role="alert" className="rounded-control bg-destructive-soft px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-6">
            <p className="flex items-center gap-1.5 text-xs text-ink-subtle">
              <Lock className="size-3.5 text-identity-600" aria-hidden="true" />
              Só você vê. Rascunhos são salvos enquanto você escreve.
            </p>
            <Button type="button" disabled={busy} onClick={() => void commit()} className="w-full sm:w-auto">
              {busy ? "Salvando..." : "Salvar anotação"}
            </Button>
          </div>
        </Card>

        {/* Biblioteca: leitura e organizacao do que ja foi escrito. */}
        <div className="flex min-w-0 flex-col lg:sticky lg:top-4 lg:self-start">
          <Tabs defaultValue="ativas">
            <TabsList variant="segmented" className="w-full">
              <TabsTrigger value="ativas" className="flex-1 justify-center">Anotações ({active.length})</TabsTrigger>
              <TabsTrigger value="lixeira" className="flex-1 justify-center">Lixeira ({trashed.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="ativas" className="pt-3">
              {active.length > 0 ? (
                <div className="relative mb-3">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle"
                    aria-hidden="true"
                  />
                  <Input
                    type="search"
                    aria-label="Buscar anotações"
                    placeholder="Buscar anotações"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="pl-9"
                  />
                </div>
              ) : null}

              {active.length === 0 ? (
                <Card>
                  <EmptyState
                    title="Nenhuma anotação ainda"
                    description="O que você salvar aparece aqui, só para você."
                    icon={<BookOpen />}
                  />
                </Card>
              ) : visiveis.length === 0 ? (
                <Card>
                  <EmptyState
                    title="Nada encontrado"
                    description="Nenhuma anotação tem esse termo no título, no texto ou nas tags."
                    icon={<Search />}
                  />
                </Card>
              ) : (
                <ul className="flex flex-col gap-2">
                  {visiveis.map((entry) => (
                    <li key={entry.id}>
                      <div
                        className={cn(
                          "motion-lift rounded-card border bg-surface p-3.5 shadow-card",
                          entry.id === draftId ? "border-brand-300 ring-2 ring-brand-100" : "border-line hover:border-brand-200",
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            aria-hidden="true"
                            className={cn(
                              "flex w-11 shrink-0 flex-col items-center rounded-control py-1.5 leading-none",
                              entry.id === draftId ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-700",
                            )}
                          >
                            <span className="text-base font-semibold tabular-nums">
                              {new Date(entry.updatedAt).getDate()}
                            </span>
                            <span className="mt-0.5 text-xs uppercase">
                              {new Date(entry.updatedAt)
                                .toLocaleDateString("pt-BR", { month: "short" })
                                .replace(".", "")}
                            </span>
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-ink">
                              {entry.title || "Sem título"}
                            </p>
                            <p className="mt-1 line-clamp-2 text-sm text-ink-muted [overflow-wrap:anywhere]">
                              {entry.content}
                            </p>
                            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-subtle">
                              <time dateTime={entry.updatedAt} className="sr-only">
                                {new Date(entry.updatedAt).toLocaleDateString("pt-BR", {
                                  day: "2-digit",
                                  month: "short",
                                })}
                              </time>
                              {entry.id === draftId ? (
                                <Badge tone="brand">Em edição</Badge>
                              ) : null}
                              <PendingSyncBadge entityId={entry.id} />
                              {entry.status === "draft" ? (
                                <Badge tone="attention">Rascunho</Badge>
                              ) : null}
                              {entry.tagIds.slice(0, 3).map((id) => (
                                <span key={id} className="rounded-pill bg-surface-muted px-2 py-0.5">
                                  {tagLabel(id)}
                                </span>
                              ))}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center">
                            <button
                              type="button"
                              onClick={() => edit(entry)}
                              aria-label={`Editar entrada: ${entry.title || "sem título"}`}
                              className="inline-flex size-11 items-center justify-center rounded-control text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink lg:size-9"
                            >
                              <Pencil className="size-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void runEntryAction(() => trashJournal(entry.id))
                              }
                              aria-label={`Mover ${entry.title || "sem título"} para a lixeira`}
                              className="inline-flex size-11 items-center justify-center rounded-control text-ink-subtle transition-colors hover:bg-destructive-soft hover:text-destructive lg:size-9"
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="lixeira" className="pt-3">
              {trashed.length === 0 ? (
                <Card>
                  <EmptyState
                    title="Lixeira vazia"
                    description="Itens excluídos ficam aqui por 30 dias."
                    icon={<Trash2 />}
                  />
                </Card>
              ) : (
                <ul className="flex flex-col gap-2">
                  {trashed.map((entry) => (
                    <li key={entry.id}>
                      <div className="rounded-card border border-line bg-surface p-3.5 shadow-card">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink">
                              {entry.title || "Sem título"}
                            </p>
                            <p className="mt-1 text-xs text-ink-subtle">
                              Expurgo em {daysUntilPurge(entry.trashedAt)} dias
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void runEntryAction(() => restoreJournal(entry.id))
                              }
                              aria-label="Restaurar anotação"
                              className="inline-flex size-11 items-center justify-center rounded-control text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink lg:size-9"
                            >
                              <RotateCcw className="size-4" aria-hidden="true" />
                            </button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => setPurgeTarget(entry.id)}
                              className="hover:bg-destructive-soft hover:text-destructive"
                            >
                              Excluir em definitivo
                            </Button>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <Dialog
        open={purgeTarget !== null}
        onOpenChange={(open) => !open && setPurgeTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir em definitivo?</DialogTitle>
            <DialogDescription>
              Esta ação não pode ser desfeita. A anotação será removida
              permanentemente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancelar</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (!purgeTarget) return;
                const id = purgeTarget;
                void runEntryAction(() => purgeJournal(id)).then((succeeded) => {
                  if (succeeded) setPurgeTarget(null);
                });
              }}
            >
              Excluir em definitivo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
