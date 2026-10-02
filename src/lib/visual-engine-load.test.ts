import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Carga do motor com MediaPipe mockado (L-396): cancelamento no meio da carga e
 * restauracao do `console.error` global. Nenhum WASM real e baixado.
 */
const faceClose = vi.fn();
const poseClose = vi.fn();
const poseCreate = vi.fn(async () => ({ detectForVideo: () => ({ landmarks: [] }), close: poseClose }));
let onFaceCreated: () => void = () => undefined;

vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  FaceLandmarker: {
    createFromOptions: async () => {
      // O runtime do MediaPipe prende `console.error` ao ser avaliado: simula isso.
      const bound = console.error.bind(console);
      bound("INFO: Created TensorFlow Lite XNNPACK delegate for CPU.");
      onFaceCreated();
      return { detectForVideo: () => ({ facialTransformationMatrixes: [] }), close: faceClose };
    },
  },
  PoseLandmarker: { createFromOptions: poseCreate },
}));

afterEach(() => {
  faceClose.mockClear();
  poseClose.mockClear();
  poseCreate.mockClear();
  onFaceCreated = () => undefined;
});

describe("loadLandmarkEngine: cancelamento e escopo do filtro de log", () => {
  it("cancelado durante a carga: fecha o que ja existe, nao cria o resto, nao inicia nada", async () => {
    const { loadLandmarkEngine } = await import("./visual-engine");
    let cancelled = false;
    onFaceCreated = () => {
      cancelled = true;
    };
    const result = await loadLandmarkEngine({}, { cancelled: () => cancelled });
    expect(result).toEqual({ engine: null, failure: "cancelled" });
    expect(faceClose).toHaveBeenCalledTimes(1);
    expect(poseCreate).not.toHaveBeenCalled();
  });

  it("carga normal: o log conhecido nao vira console.error e o global volta ao original", async () => {
    const { loadLandmarkEngine } = await import("./visual-engine");
    const original = console.error;
    const errorSpy = vi.fn();
    console.error = errorSpy;
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const result = await loadLandmarkEngine({});
      expect(result.failure).toBeNull();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith("INFO: Created TensorFlow Lite XNNPACK delegate for CPU.");
      expect(console.error).toBe(errorSpy);
      // Fechar duas vezes fecha cada landmarker uma vez so.
      result.engine!.close();
      result.engine!.close();
      expect(faceClose).toHaveBeenCalledTimes(1);
      expect(poseClose).toHaveBeenCalledTimes(1);
      expect(() => result.engine!.detectFace(1)).toThrow("engine_closed");
    } finally {
      console.error = original;
      info.mockRestore();
    }
  });
});
