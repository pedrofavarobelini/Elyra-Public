import { describe, expect, it } from "vitest";

import { RemoteTrackForbiddenError, assertLocalCaptureParticipant, isCallCaptureResource } from "./capture-guard";
import { DEVICE_STATUS_COPY, classifyMediaError } from "./devices";

/**
 * Dono do track (PRO-7R): a captura Elyra so aceita a propria pessoa. O teste
 * NEGATIVO e o que importa: um participante remoto (o profissional) injetado
 * no caminho da captura e recusado antes de qualquer MediaStreamTrack sair.
 */
describe("guarda de captura: so o track local", () => {
  it("recusa participante remoto injetado", () => {
    const professional = { isLocal: false, identity: "p_remoto" };
    expect(() => assertLocalCaptureParticipant(professional)).toThrow(RemoteTrackForbiddenError);
  });

  it("recusa ausencia de participante e objeto sem a marca de local", () => {
    expect(() => assertLocalCaptureParticipant(null)).toThrow(RemoteTrackForbiddenError);
    expect(() => assertLocalCaptureParticipant(undefined)).toThrow(RemoteTrackForbiddenError);
    expect(() => assertLocalCaptureParticipant({ isLocal: "true" } as unknown as { isLocal: boolean })).toThrow(
      RemoteTrackForbiddenError,
    );
  });

  it("aceita o participante local", () => {
    expect(() => assertLocalCaptureParticipant({ isLocal: true })).not.toThrow();
  });

  it("tela nunca entra na captura da chamada", () => {
    expect(isCallCaptureResource("microphone")).toBe(true);
    expect(isCallCaptureResource("camera")).toBe(true);
    expect(isCallCaptureResource("screen")).toBe(false);
  });
});

describe("estado de dispositivo no pre-call", () => {
  it.each([
    ["NotAllowedError", "denied"],
    ["SecurityError", "denied"],
    ["NotFoundError", "missing"],
    ["OverconstrainedError", "missing"],
    ["NotReadableError", "busy"],
    ["AbortError", "busy"],
    ["TypeError", "error"],
  ])("%s => %s", (name, status) => {
    expect(classifyMediaError({ name })).toBe(status);
  });

  it("sem camera, a copy diz que a pessoa entra so com audio (nunca trava)", () => {
    expect(DEVICE_STATUS_COPY.camera.missing).toMatch(/só com áudio/);
    expect(DEVICE_STATUS_COPY.camera.denied).toMatch(/só com áudio/);
    expect(DEVICE_STATUS_COPY.microphone.missing).toMatch(/sem áudio/);
  });
});
