import { EventEmitter } from "node:events";

import { RoomEvent } from "livekit-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { localEncryptionConfirmed } from "./call-adapter";

/**
 * Race achada no QA sob CPU saturada: o E2EE do participante local e
 * confirmado pelo worker DEPOIS de `connect()`. Ler a flag uma vez derrubava
 * chamadas validas; esperar sem prazo deixaria midia sem E2EE. O contrato e:
 * espera a confirmacao, com prazo, e falha fechada.
 */
function fakeRoom(initial = false) {
  const emitter = new EventEmitter();
  const room = {
    isE2EEEnabled: initial,
    on: (event: string, listener: (...args: unknown[]) => void) => {
      emitter.on(event, listener);
      return room;
    },
    off: (event: string, listener: (...args: unknown[]) => void) => {
      emitter.off(event, listener);
      return room;
    },
    emit: (event: string, ...args: unknown[]) => emitter.emit(event, ...args),
    listeners: () => emitter.eventNames().length,
  };
  return room;
}

afterEach(() => vi.useRealTimers());

describe("confirmacao do E2EE local antes de publicar", () => {
  it("ja confirmado: segue na hora", async () => {
    await expect(localEncryptionConfirmed(fakeRoom(true) as never, 10_000)).resolves.toBe(true);
  });

  it("confirmacao que chega depois do connect (CPU alta): segue", async () => {
    vi.useFakeTimers();
    const room = fakeRoom();
    const result = localEncryptionConfirmed(room as never, 10_000);
    vi.advanceTimersByTime(4_000);
    room.isE2EEEnabled = true;
    room.emit(RoomEvent.ParticipantEncryptionStatusChanged, true, { isLocal: true });
    await expect(result).resolves.toBe(true);
    expect(room.listeners()).toBe(0);
  });

  it("evento de participante REMOTO nao confirma o local", async () => {
    vi.useFakeTimers();
    const room = fakeRoom();
    const result = localEncryptionConfirmed(room as never, 10_000);
    room.emit(RoomEvent.ParticipantEncryptionStatusChanged, true, { isLocal: false });
    vi.advanceTimersByTime(10_000);
    await expect(result).resolves.toBe(false);
  });

  it("sem confirmacao no prazo: falha fechada", async () => {
    vi.useFakeTimers();
    const room = fakeRoom();
    const result = localEncryptionConfirmed(room as never, 10_000);
    room.emit(RoomEvent.ParticipantEncryptionStatusChanged, false, { isLocal: true });
    vi.advanceTimersByTime(10_000);
    await expect(result).resolves.toBe(false);
    expect(room.listeners()).toBe(0);
  });

  it("sala cai durante a espera: falha fechada", async () => {
    const room = fakeRoom();
    const result = localEncryptionConfirmed(room as never, 10_000);
    room.emit(RoomEvent.Disconnected);
    await expect(result).resolves.toBe(false);
  });
});
