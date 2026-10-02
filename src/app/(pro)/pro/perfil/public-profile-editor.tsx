"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type FormEvent } from "react";

import { DirectoryCard } from "@/components/professional/directory-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ToggleChips as Toggle } from "@/components/ui/toggle-chips";
import {
  AREA_LABEL,
  DIRECTORY_AREAS,
  DIRECTORY_LANGUAGES,
  DIRECTORY_MODALITIES,
  discoveryVisibility,
  LANGUAGE_LABEL,
  MODALITY_LABEL,
  publicProfileMissing,
  UF_CODES,
  type DiscoveryVisibility,
} from "@/lib/contracts/professional-directory";
import type { VerificationStatus } from "@/lib/contracts/professional-verification";

export interface PublicProfileState {
  publicProfile: {
    slug: string;
    listed: boolean;
    display_name: string | null;
    bio: string | null;
    city: string | null;
    state: string | null;
    modalities: string[];
    areas: string[];
    languages: string[];
  } | null;
  visibility: DiscoveryVisibility;
}


export function PublicProfileEditor({
  initial,
  verification,
  registration,
}: {
  initial: PublicProfileState;
  verification: VerificationStatus;
  registration: { council: string; region: string | null; number: string; reviewedAt: string | null };
}) {
  const saved = initial.publicProfile;
  const [listed, setListed] = useState(saved?.listed ?? false);
  const [displayName, setDisplayName] = useState(saved?.display_name ?? "");
  const [bio, setBio] = useState(saved?.bio ?? "");
  const [city, setCity] = useState(saved?.city ?? "");
  const [state, setState] = useState(saved?.state ?? "");
  const [modalities, setModalities] = useState<string[]>(saved?.modalities ?? []);
  const [areas, setAreas] = useState<string[]>(saved?.areas ?? []);
  const [languages, setLanguages] = useState<string[]>(saved?.languages ?? ["pt"]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const draft = {
    displayName: displayName.trim() || null,
    city: city.trim() || null,
    state: state || null,
    modalities,
    areas,
    languages,
  };
  const visibility = discoveryVisibility({ verification, listed, missing: publicProfileMissing(draft) });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/professional/public-profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listed, displayName, bio, city, state: state || null, modalities, areas, languages }),
      });
      const payload = (await response.json()) as { data?: PublicProfileState; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error ?? "Não foi possível salvar o perfil público.");
      setMessage({ tone: "ok", text: listed ? "Perfil público salvo." : "Perfil salvo, sem aparecer na descoberta." });
    } catch (caught) {
      setMessage({ tone: "error", text: caught instanceof Error ? caught.message : "Não foi possível salvar o perfil público." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="perfil-publico" aria-labelledby="perfil-publico-titulo" className="mt-5 scroll-mt-20 lg:mt-6" data-testid="public-profile">
      <h2 id="perfil-publico-titulo" className="mb-3 text-lg font-semibold tracking-tight text-ink">
        Perfil público
      </h2>
      <div className="grid items-start gap-5 lg:gap-6 xl:grid-cols-2" data-layout="columns">
        <div className="flex min-w-0 flex-col gap-4">
          <p
            className={cn(
              "flex items-start gap-2 rounded-card px-4 py-3 text-sm",
              visibility.visible ? "bg-positive-soft text-positive" : "bg-surface-muted text-ink-muted",
            )}
            data-testid="discovery-visibility"
            data-visible={visibility.visible}
          >
            {visibility.visible ? <Eye className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
            {visibility.visible ? "Com estas informações salvas, seu perfil aparece na descoberta." : visibility.message}
          </p>
          <div>
            <p className="mb-2 text-sm font-medium text-ink">Como seu perfil aparece para outras pessoas</p>
            <DirectoryCard
              preview
              profile={{
                slug: null,
                display_name: draft.displayName,
                council: registration.council,
                council_region: registration.region,
                registration_number: registration.number,
                verified_at: verification === "verified" ? registration.reviewedAt : null,
                city: draft.city,
                state: draft.state,
                modalities,
                areas,
                languages,
              }}
            />
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle as="h3">O que aparece e o que nunca aparece</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <p className="font-medium text-ink">Aparece para quem busca</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink-muted">
                <li>Nome de exibição, cidade e UF</li>
                <li>Registro no conselho e a data da conferência</li>
                <li>Modalidade, idiomas e áreas declaradas por você</li>
                <li>Sua apresentação, no perfil completo</li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-ink">Nunca aparece</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink-muted">
                <li>E-mail, telefone, endereço e documentos</li>
                <li>Quem revisou sua verificação</li>
                <li>Pessoas acompanhadas, vínculos e acessos</li>
                <li>Notas e qualquer dado compartilhado com você</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="mt-5 lg:mt-6">
        <Card>
          <CardHeader>
            <CardTitle as="h3">Descoberta de profissionais</CardTitle>
            <CardDescription>
              Pessoas com conta na Elyra podem encontrar seu perfil pela busca. Só aparece o que está aqui, e só com a exibição
              ligada e o registro verificado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-5 lg:grid-cols-2 lg:gap-x-8" onSubmit={submit}>
              <div className="flex min-w-0 flex-col gap-5">
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-control border border-line bg-surface-muted/60 p-3">
                  <input
                    type="checkbox"
                    checked={listed}
                    onChange={(event) => setListed(event.target.checked)}
                    className="mt-0.5 size-5 shrink-0 accent-brand-600"
                    aria-describedby="perfil-publico-optin-ajuda"
                  />
                  <span>
                    <span className="block text-sm font-medium text-ink">Exibir meu perfil na descoberta</span>
                    <span id="perfil-publico-optin-ajuda" className="block text-xs text-ink-muted">
                      Desligar tira o perfil da busca na hora. Nada de e-mail, telefone, documento ou vínculos é exibido.
                    </span>
                  </span>
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <Label htmlFor="publico-nome">Nome de exibição</Label>
                    <Input id="publico-nome" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="publico-cidade">Cidade</Label>
                    <Input id="publico-cidade" value={city} onChange={(e) => setCity(e.target.value)} maxLength={60} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="publico-uf">UF</Label>
                    <select
                      id="publico-uf"
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      className="flex min-h-11 w-full rounded-control border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                    >
                      <option value="">Escolha</option>
                      {UF_CODES.map((uf) => (
                        <option key={uf} value={uf}>{uf}</option>
                      ))}
                    </select>
                  </div>
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium text-ink">Modalidade</legend>
                <Toggle name="modalidade" options={DIRECTORY_MODALITIES.map((value) => ({ value, label: MODALITY_LABEL[value] }))} selected={modalities} onChange={setModalities} />
              </fieldset>
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium text-ink">Idiomas de atendimento</legend>
                <Toggle name="idioma" options={DIRECTORY_LANGUAGES.map((value) => ({ value, label: LANGUAGE_LABEL[value] }))} selected={languages} onChange={setLanguages} />
              </fieldset>
              </div>
              <div className="flex min-w-0 flex-col gap-5">
                <fieldset className="flex flex-col gap-2">
                  <legend className="text-sm font-medium text-ink">
                    Áreas de atuação <span className="font-normal text-ink-muted">(declaradas por você, até 6)</span>
                  </legend>
                  <Toggle name="area" options={DIRECTORY_AREAS.map((value) => ({ value, label: AREA_LABEL[value] }))} selected={areas} onChange={setAreas} max={6} />
                </fieldset>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="publico-bio">Apresentação</Label>
                  <textarea
                    id="publico-bio"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    maxLength={600}
                    rows={4}
                    className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                    aria-describedby="publico-bio-ajuda"
                  />
                  <p id="publico-bio-ajuda" className="text-xs text-ink-muted">
                    {bio.length}/600. Descreva como você trabalha; evite promessa de resultado.
                  </p>
              </div>
              </div>

              <div className="flex flex-col gap-3 lg:col-span-2">
                {message ? (
                  <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-sm text-destructive" : "text-sm text-positive"}>
                    {message.text}
                  </p>
                ) : null}
                <Button type="submit" className="self-start" disabled={busy}>
                  {busy ? "Salvando..." : "Salvar perfil público"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
