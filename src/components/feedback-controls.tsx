"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useActionState, useState } from "react";

import {
  CORRECTION_NOT_TRAINING_NOTICE,
  TRANSCRIPTION_FEEDBACK_REASONS,
  TRANSCRIPTION_FEEDBACK_REASON_LABEL,
  INITIAL_FEEDBACK_STATE,
  type FeedbackTarget,
  type FeedbackView,
  type TranscriptCorrectionView,
} from "@/lib/contracts/feedback";
import { Button } from "@/components/ui/button";
import {
  correctionAction,
  rateAction,
} from "@/app/(app)/sessoes/[id]/feedback-actions";

/**
 * Avaliacao e correcao, dentro do card a que pertencem.
 *
 * ## Por que dois controles, e nao um
 *
 * O polegar da transcricao e o polegar da interpretacao vivem em cards
 * diferentes porque avaliam **sistemas diferentes**. Um controle unico no fim da
 * pagina produziria uma nota que ninguem sabe ler: uma queda nao diria se o
 * reconhecedor errou as palavras ou se o Veltrix leu mal os sinais, e as duas
 * coisas se consertam em lugares opostos.
 *
 * ## Por que uma acao por card, e nao uma por botao
 *
 * Avaliar e desavaliar sao a mesma decisao sobre o mesmo alvo. Com duas acoes,
 * a tela ganhava dois estados independentes e exibia o **primeiro** que tivesse
 * mensagem: quem removesse a avaliacao continuava lendo "sua avaliacao foi
 * registrada", a tela afirmando o oposto do que acabara de acontecer. Um estado
 * por card significa que a mensagem exibida e sempre a da ultima coisa que
 * aconteceu, sem precisar desempatar.
 *
 * ## O que o texto da tela evita prometer
 *
 * Nenhuma frase aqui diz "vamos melhorar com isso" ou "o sistema vai aprender".
 * Seria a forma mais facil de obter consentimento de treinamento por silencio —
 * a pessoa clicaria supondo que doou o dado. O aviso diz o contrario, e diz
 * antes de ela escrever qualquer coisa.
 */

const RATING_LABEL: Record<FeedbackTarget, { up: string; down: string }> = {
  transcription: {
    up: "A transcrição está correta",
    down: "A transcrição tem erros",
  },
  interpretation: {
    up: "A leitura faz sentido",
    down: "A leitura não faz sentido",
  },
};

export function FeedbackControls({
  sessionId,
  targetType,
  targetId = null,
  current,
}: {
  sessionId: string;
  targetType: FeedbackTarget;
  targetId?: string | null;
  current: FeedbackView | null;
}) {
  const [state, rate, pending] = useActionState(
    rateAction,
    INITIAL_FEEDBACK_STATE,
  );
  // Recusa abre os motivos; nenhum deles e obrigatorio.
  const [showReasons, setShowReasons] = useState(false);

  const rating = current?.rating ?? null;
  const labels = RATING_LABEL[targetType];

  const identity = (
    <>
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="targetType" value={targetType} />
      {targetId ? <input type="hidden" name="targetId" value={targetId} /> : null}
    </>
  );

  return (
    <div className="mt-4 border-t border-border/60 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Isso foi útil?</span>

        <form action={rate} onSubmit={() => setShowReasons(false)}>
          {identity}
          <input type="hidden" name="rating" value="positive" />
          <Button
            type="submit"
            variant={rating === "positive" ? "secondary" : "ghost"}
            size="sm"
            disabled={pending}
            aria-label={labels.up}
            aria-pressed={rating === "positive"}
            title={labels.up}
          >
            <ThumbsUp aria-hidden className="size-4" />
          </Button>
        </form>

        <form
          action={rate}
          onSubmit={() => setShowReasons(targetType === "transcription")}
        >
          {identity}
          <input type="hidden" name="rating" value="negative" />
          <Button
            type="submit"
            variant={rating === "negative" ? "secondary" : "ghost"}
            size="sm"
            disabled={pending}
            aria-label={labels.down}
            aria-pressed={rating === "negative"}
            title={labels.down}
          >
            <ThumbsDown aria-hidden className="size-4" />
          </Button>
        </form>

        {rating !== null ? (
          <form action={rate} onSubmit={() => setShowReasons(false)}>
            {identity}
            {/* Remover e um valor da mesma decisao, e nao outra acao. */}
            <input type="hidden" name="rating" value="clear" />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              disabled={pending}
              className="text-xs"
            >
              Remover avaliação
            </Button>
          </form>
        ) : null}
      </div>

      {/*
        Motivos so aparecem para a transcricao, e so depois da recusa. Eles
        descrevem o erro da MAQUINA - nenhum deles e sobre quem falou.
      */}
      {showReasons && targetType === "transcription" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="w-full text-xs text-muted-foreground">
            Se quiser, diga o que aconteceu (opcional):
          </span>
          {TRANSCRIPTION_FEEDBACK_REASONS.map((reason) => (
            <form action={rate} key={reason}>
              {identity}
              <input type="hidden" name="rating" value="negative" />
              <input type="hidden" name="reason" value={reason} />
              <Button
                type="submit"
                variant={current?.reason === reason ? "secondary" : "soft"}
                size="sm"
                disabled={pending}
                className="text-xs"
              >
                {TRANSCRIPTION_FEEDBACK_REASON_LABEL[reason]}
              </Button>
            </form>
          ))}
        </div>
      ) : null}

      {state.message ? (
        <p aria-live="polite" className="mt-2 text-xs text-muted-foreground">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Correcao da transcricao.
 *
 * O original fica visivel ao lado do corrigido, sempre. Esconde-lo faria a tela
 * afirmar que o ASR disse o que a pessoa escreveu — e a diferenca entre os dois
 * e a unica evidencia de que houve erro.
 */
export function TranscriptCorrection({
  sessionId,
  originalText,
  correction,
}: {
  sessionId: string;
  originalText: string;
  correction: TranscriptCorrectionView | null;
}) {
  const [state, submit, pending] = useActionState(
    correctionAction,
    INITIAL_FEEDBACK_STATE,
  );

  /**
   * Qual revisao a pessoa abriu para editar.
   *
   * Guardar a revisao, e nao um booleano, faz o formulario **se fechar sozinho**
   * quando a correcao e gravada: salvar cria a revisao seguinte, o numero deixa
   * de bater, e a tela volta para a leitura — sem efeito e sem `setState` dentro
   * de `useEffect`.
   *
   * Com um booleano, o formulario continuava aberto depois de salvar: a pessoa
   * nao via a propria correcao registrada e, pior, nao via o texto original do
   * ASR reaparecer ao lado dela. A prova visivel de que o original nao foi
   * sobrescrito so existe na visao de leitura.
   */
  const [editingRevision, setEditingRevision] = useState<number | null>(null);
  const currentRevision = correction?.revision ?? 0;
  const editing = editingRevision === currentRevision;

  const notice = state.message ? (
    <p aria-live="polite" className="text-xs text-muted-foreground">
      {state.message}
    </p>
  ) : null;

  if (correction && !editing) {
    return (
      <div className="mt-4 space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Sua correção
          </p>
          <p className="mt-1 text-sm">{correction.correctedText}</p>
        </div>
        <div>
          {/*
            O original permanece a vista: ele e o que o reconhecedor produziu, e
            a Elyra nao finge que produziu outra coisa.
          */}
          <p className="text-xs font-medium text-muted-foreground">
            Texto original da transcrição automática
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {correction.originalText}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {CORRECTION_NOT_TRAINING_NOTICE}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="soft"
            size="sm"
            onClick={() => setEditingRevision(currentRevision)}
          >
            Corrigir novamente
          </Button>
          <form action={submit}>
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="intent" value="revoke" />
            <input type="hidden" name="revision" value={correction.revision} />
            <Button type="submit" variant="ghost" size="sm" disabled={pending}>
              Remover correção
            </Button>
          </form>
        </div>
        {notice}
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="mt-3 space-y-2">
        <Button
          type="button"
          variant="soft"
          size="sm"
          onClick={() => setEditingRevision(currentRevision)}
        >
          Corrigir transcrição
        </Button>
        {notice}
      </div>
    );
  }

  return (
    <form action={submit} className="mt-4 space-y-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="intent" value="save" />
      <label
        className="block text-xs font-medium text-muted-foreground"
        htmlFor="correctedText"
      >
        Escreva o que você disse de fato
      </label>
      <textarea
        id="correctedText"
        name="correctedText"
        defaultValue={correction?.correctedText ?? originalText}
        rows={5}
        maxLength={20_000}
        className="w-full rounded-md border border-input bg-background p-2 text-sm"
      />
      <p className="text-xs text-muted-foreground">
        {CORRECTION_NOT_TRAINING_NOTICE}
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Salvar correção
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setEditingRevision(null)}
        >
          Cancelar
        </Button>
      </div>
      {notice}
    </form>
  );
}
