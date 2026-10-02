/**
 * Estado de cada dispositivo no pre-call, em texto e sem adivinhar:
 * `prompt` (ainda nao perguntado), `granted`, `denied`, `missing` (nao ha
 * dispositivo), `busy` (outro app usando), `unsupported` (navegador sem API).
 */
export type DeviceStatus = "prompt" | "granted" | "denied" | "missing" | "busy" | "unsupported" | "error";

export function classifyMediaError(error: unknown): DeviceStatus {
  const name = (error as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "missing";
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") return "busy";
  return "error";
}

export const DEVICE_STATUS_COPY: Record<"microphone" | "camera", Record<DeviceStatus, string>> = {
  microphone: {
    prompt: "Ainda não testado.",
    granted: "Pronto.",
    denied: "Bloqueado no navegador. Libere o microfone no ícone ao lado do endereço e teste de novo.",
    missing: "Nenhum microfone encontrado. Você entra sem áudio e a outra pessoa não vai te ouvir.",
    busy: "Outro aplicativo está usando o microfone. Feche-o e teste de novo.",
    unsupported: "Este navegador não oferece microfone para a Elyra.",
    error: "Não foi possível abrir o microfone. Teste de novo.",
  },
  camera: {
    prompt: "Ainda não testada.",
    granted: "Pronta.",
    denied: "Bloqueada no navegador. Você pode entrar só com áudio.",
    missing: "Nenhuma câmera encontrada. Você entra só com áudio.",
    busy: "Outro aplicativo está usando a câmera. Você pode entrar só com áudio.",
    unsupported: "Este navegador não oferece câmera. Você entra só com áudio.",
    error: "Não foi possível abrir a câmera. Você pode entrar só com áudio.",
  },
};

/** Estado inicial pela Permissions API, quando existe; nunca abre dispositivo. */
export async function queryPermission(name: "microphone" | "camera"): Promise<DeviceStatus> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return "unsupported";
  try {
    const result = await navigator.permissions.query({ name: name as PermissionName });
    if (result.state === "denied") return "denied";
    return "prompt";
  } catch {
    return "prompt";
  }
}
