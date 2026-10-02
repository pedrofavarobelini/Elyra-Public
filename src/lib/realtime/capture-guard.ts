/**
 * Dono do track (PRO-7R). A captura Elyra (gravacao, ASR, analise, PedroCore,
 * relatorio) so aceita midia da PROPRIA pessoa. O track remoto - a voz e a
 * imagem do profissional - nunca entra, nem por engano de chamada: esta
 * guarda recusa qualquer participante que nao seja o local.
 *
 * Sem diarizacao no MVP: o falante da captura e, por construcao, quem captura.
 */
export type CallCaptureResource = "microphone" | "camera";

export class RemoteTrackForbiddenError extends Error {
  constructor() {
    super("remote_track_forbidden");
    this.name = "RemoteTrackForbiddenError";
  }
}

export function assertLocalCaptureParticipant(participant: { readonly isLocal: boolean } | null | undefined) {
  if (!participant || participant.isLocal !== true) throw new RemoteTrackForbiddenError();
}

/** A captura embutida so lida com microfone e camera; tela nunca entra. */
export function isCallCaptureResource(value: string): value is CallCaptureResource {
  return value === "microphone" || value === "camera";
}
