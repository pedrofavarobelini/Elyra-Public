"use client";

import { Download, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOfflineGateway } from "@/components/offline/offline-context";
import { DELETION_CONFIRMATION_PHRASE } from "@/lib/contracts/subject-rights";


export function PrivacyRights() {
  const offlineGateway = useOfflineGateway();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const response = await fetch("/api/me/export");
      if (!response.ok) throw new Error("Não foi possível gerar a exportação.");

      // O arquivo e montado no proprio navegador a partir da resposta
      // autenticada: nao existe link publico nem arquivo intermediario.
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `elyra-meus-dados-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "Não foi possível gerar a exportação.",
      );
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch("/api/me/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "Não foi possível excluir a conta.");
      }
      /*
       * Recarregamento completo, e nao `router.push`, de proposito: a conta
       * deixou de existir e nenhum estado de cliente — cache do App Router,
       * store em memoria, dado ja renderizado — pode sobreviver a exclusao.
       * Navegar pelo roteador manteria a arvore React viva com os dados de uma
       * conta que nao existe mais.
       */

      await offlineGateway?.clearLocal();
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/entrar");
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "Não foi possível excluir a conta.",
      );
    } finally {
      setDeleting(false);
    }
  }

  const confirmationMatches = confirmation === DELETION_CONFIRMATION_PHRASE;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Seus dados</CardTitle>
          <CardDescription>
            Você pode levar seus dados com você ou encerrar sua conta quando
            quiser.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-line">
          <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-ink">Exportar meus dados</p>
              <p className="text-sm text-ink-subtle">
                Baixa um arquivo com seus registros, em formato aberto.
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => void handleExport()}
              disabled={exporting}
            >
              <Download aria-hidden="true" className="size-4" />
              {exporting ? "Preparando..." : "Exportar"}
            </Button>
          </div>
          {exportError ? (
            <p role="alert" className="py-2 text-sm text-destructive">
              {exportError}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-ink">Excluir minha conta</p>
              <p className="text-sm text-ink-subtle">
                Remove sua conta e seus dados. Esta ação não pode ser desfeita.
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmation("");
                setDeleteError(null);
                setConfirmOpen(true);
              }}
            >
              <ShieldAlert aria-hidden="true" className="size-4" />
              Excluir conta
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => !open && setConfirmOpen(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir sua conta e seus dados?</DialogTitle>
            <DialogDescription>
              Seus registros, sessões, gravações e compartilhamentos serão
              removidos. Profissionais conectados perdem o acesso imediatamente.
              Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="deletion-confirmation">
              Para confirmar, digite{" "}
              <strong>{DELETION_CONFIRMATION_PHRASE}</strong>
            </Label>
            <Input
              id="deletion-confirmation"
              value={confirmation}
              autoComplete="off"
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>

          {deleteError ? (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          ) : null}

          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!confirmationMatches || deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? "Excluindo..." : "Excluir em definitivo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
