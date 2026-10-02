"use client";

import { Camera, Trash2, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  ProfilePhotoValidationError,
  normalizeProfilePhoto,
} from "@/lib/profile-photo";

function photoError(error: unknown): string {
  if (error instanceof ProfilePhotoValidationError) {
    if (error.code === "size") return "Escolha uma imagem de até 5 MB.";
    if (error.code === "type") return "Use uma imagem JPEG, PNG ou WebP verdadeira.";
    return "Não foi possível preparar essa imagem.";
  }
  return error instanceof Error ? error.message : "Não foi possível atualizar a foto.";
}

export function ProfilePhotoEditor({
  initials,
  initialHasPhoto,
}: {
  initials: string;
  initialHasPhoto: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hasPhoto, setHasPhoto] = useState(initialHasPhoto);
  const [photoVersion, setPhotoVersion] = useState(0);
  const [prepared, setPrepared] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const discardPreview = () => {
    setPrepared(null);
    setPreviewUrl(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setMessage(null);
    try {
      const normalized = await normalizeProfilePhoto(file);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPrepared(normalized);
      setPreviewUrl(URL.createObjectURL(normalized));
    } catch (caught) {
      discardPreview();
      setError(photoError(caught));
    }
  };

  const save = async () => {
    if (!prepared) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("photo", prepared);
      const response = await fetch("/api/me/profile/photo", { method: "POST", body: form });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível salvar a foto.");
      setHasPhoto(true);
      setPhotoVersion(Date.now());
      discardPreview();
      setMessage("Foto atualizada.");
    } catch (caught) {
      setError(photoError(caught));
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/me/profile/photo", { method: "DELETE" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível remover a foto.");
      setHasPhoto(false);
      discardPreview();
      setMessage("Foto removida. Suas iniciais voltaram a aparecer.");
    } catch (caught) {
      setError(photoError(caught));
    } finally {
      setPending(false);
    }
  };

  const source = previewUrl ?? (hasPhoto ? `/api/me/profile/photo?v=${photoVersion}` : null);

  return (
    <div className="flex max-w-full flex-col items-start gap-2">
      <div className="relative inline-flex size-20 shrink-0 overflow-hidden rounded-pill bg-surface text-2xl font-semibold text-brand-700 shadow-card ring-4 ring-surface/60">
        {source ? (
          <Image
            src={source}
            alt="Foto de perfil"
            width={80}
            height={80}
            unoptimized
            className="size-full object-cover"
          />
        ) : (
          <span aria-hidden="true" className="flex size-full items-center justify-center">{initials}</span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label="Selecionar foto de perfil"
        disabled={pending}
        onChange={(event) => void choose(event.target.files?.[0])}
      />

      <div className="flex flex-wrap gap-2">
        {prepared ? (
          <>
            <Button type="button" size="sm" disabled={pending} onClick={() => void save()}>
              {pending ? "Enviando..." : "Confirmar foto"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={discardPreview}>
              <X className="size-4" aria-hidden="true" /> Cancelar
            </Button>
          </>
        ) : (
          <>
            <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => inputRef.current?.click()}>
              <Camera className="size-4" aria-hidden="true" /> {hasPhoto ? "Trocar foto" : "Adicionar foto"}
            </Button>
            {hasPhoto ? (
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => void remove()}>
                <Trash2 className="size-4" aria-hidden="true" /> Remover
              </Button>
            ) : null}
          </>
        )}
      </div>
      <p className="max-w-64 text-xs text-ink-subtle">JPEG, PNG ou WebP, até 5 MB. A Elyra recorta, reduz e remove metadados antes do envio privado.</p>
      <div aria-live="polite" className="min-h-5 text-xs">
        {error ? <span role="alert" className="text-destructive">{error}</span> : null}
        {message ? <span className="text-positive">{message}</span> : null}
      </div>
    </div>
  );
}
