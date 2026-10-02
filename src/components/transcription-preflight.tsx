"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import type { LocalSpeechAvailability } from "@/lib/multimodal-derivation";
import { ASR_DOWNLOAD_BYTES } from "@/lib/speech/browser-runtime";
import {
  speechPreparation, transcriptionPreflight, describePreparationProgress, SPEECH_FAILURE_LABEL,
  type PreparationSnapshot,
} from "@/lib/speech/preparation";

export function useSpeechPreparation() {
  return useSyncExternalStore(
    speechPreparation.subscribe, speechPreparation.getSnapshot, speechPreparation.getServerSnapshot,
  );
}

export function TranscriptionPreflight({ native, preparation, onWithout }: {
  native: LocalSpeechAvailability | null;
  preparation: PreparationSnapshot;
  onWithout?: () => void;
}) {
  useEffect(() => () => speechPreparation.cancel(), []);
  const state = transcriptionPreflight(true, native, preparation);
  const busy = preparation.status === "preparing" || preparation.status === "cancelling";
  return (
    <div className="mt-3 rounded-control bg-attention-soft p-3 text-sm text-ink"
      role="status" data-testid="transcription-preflight" data-state={state}
      data-failure={preparation.failure ?? undefined}>
      {state === "READY_NATIVE" ? <p>Transcrição no aparelho pronta pelo navegador.</p>
        : state === "READY_LOCAL" ? <p>Transcrição local pronta. Você pode iniciar a sessão.</p>
        : state === "CHECKING" ? <p>Verificando transcrição no aparelho…</p>
        : <>
          <p>{native === "unsupported"
            ? "Não foi possível confirmar transcrição local pelo navegador."
            : "Seu navegador não oferece transcrição local em português."} O Elyra pode usar o reconhecimento local próprio.</p>
          <p className="mt-1">Prepare antes de iniciar ou escolha continuar sem transcrição. O áudio permanece no aparelho.</p>
          {preparation.failure ? <p className="mt-2">{SPEECH_FAILURE_LABEL[preparation.failure]}</p> : null}
          {busy ? <div className="mt-2" data-testid="transcription-preparation-progress">
            <p>{preparation.status === "cancelling" ? "Concluindo cancelamento…" : "Preparando reconhecimento local…"}</p>
            {preparation.status === "preparing" && preparation.progress ? <>
              <p className="mt-1">{describePreparationProgress(preparation.progress)}</p>
              <p className="mt-1">O primeiro preparo pode levar vários minutos, conforme a conexão. Nas próximas vezes o navegador pode aproveitar os arquivos já baixados.</p>
            </> : null}
          </div> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {/* O rótulo com o tamanho do download não cabe numa linha em 320–390 px;
                o Button padrão é `whitespace-nowrap` + altura fixa, então aqui ele
                quebra linha e cresce, mantendo o alvo mínimo de 44 px. */}
            <Button size="sm" variant="secondary" disabled={busy}
              className="h-auto min-h-11 max-w-full whitespace-normal py-2 text-center lg:min-h-9"
              onClick={() => { if (native !== "available") void speechPreparation.prepare(); }}>
              Preparar transcrição local (~{Math.round(ASR_DOWNLOAD_BYTES / 1_000_000)} MB)
            </Button>
            {preparation.status === "preparing" ? <Button size="sm" variant="ghost" onClick={() => speechPreparation.cancel()}>Cancelar preparo</Button> : null}
          </div>
        </>}
      {state !== "READY_NATIVE" && state !== "READY_LOCAL" && onWithout ? (
        <Button className="mt-2" size="sm" variant="ghost" onClick={onWithout}>Continuar sem transcrição</Button>
      ) : null}
    </div>
  );
}
