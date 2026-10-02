export const CAPABILITY_STATUS = {
  SUPPORTED: "SUPPORTED",
  UNSUPPORTED_PLATFORM: "UNSUPPORTED_PLATFORM",
  UNSUPPORTED_BROWSER: "UNSUPPORTED_BROWSER",
  CAPABILITY_NOT_AVAILABLE: "CAPABILITY_NOT_AVAILABLE",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  EXTERNAL_CONFIGURATION_REQUIRED: "EXTERNAL_CONFIGURATION_REQUIRED",
  NOT_CONFIGURED: "NOT_CONFIGURED",
} as const;

export type CapabilityStatus =
  (typeof CAPABILITY_STATUS)[keyof typeof CAPABILITY_STATUS];

export interface CapabilityAssessment {
  status: CapabilityStatus;
  reason: string;
  alternative: string | null;
}

const RP_ID_HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * RP ID que o cliente espera, espelho do `webauthn.rp_id` do Supabase Auth do
 * ambiente. `NEXT_PUBLIC_ELYRA_PASSKEY_RP_ID` e lido no BUILD (Next inline);
 * ausente ou invalido (esquema, porta, caminho, IP literal) cai em `localhost`,
 * o RP ID do QA local. So decide se o botao aparece: quem valida a origem e o
 * navegador + GoTrue, entao um valor errado aqui nunca abre acesso.
 */
export function configuredPasskeyRpId(
  value: string | undefined = process.env.NEXT_PUBLIC_ELYRA_PASSKEY_RP_ID,
): string {
  const normalized = (value ?? "").trim().toLocaleLowerCase("en-US");
  if (!RP_ID_HOSTNAME.test(normalized) || IPV4_LITERAL.test(normalized)) return "localhost";
  return normalized;
}

export function passkeyOriginSupported(
  hostname: string,
  configuredRpId = configuredPasskeyRpId(),
): boolean {
  const normalizedHostname = hostname.toLocaleLowerCase("en-US");
  const normalizedRpId = configuredRpId.toLocaleLowerCase("en-US");
  return normalizedHostname === normalizedRpId
    || normalizedHostname.endsWith(`.${normalizedRpId}`);
}

export function passkeyCapability(
  externalConfigured: boolean,
  browserSupported: boolean | null,
  originSupported = true,
): CapabilityAssessment {
  if (!externalConfigured) {
    return {
      status: CAPABILITY_STATUS.EXTERNAL_CONFIGURATION_REQUIRED,
      reason: "Chaves de acesso ainda não estão habilitadas no serviço de autenticação deste ambiente.",
      alternative: "Continue com senha, Google e MFA.",
    };
  }
  if (!originSupported) {
    return {
      status: CAPABILITY_STATUS.CAPABILITY_NOT_AVAILABLE,
      reason: "Chaves de acesso não estão disponíveis neste ambiente de teste porque a origem não corresponde ao RP ID configurado.",
      alternative: "Continue com senha, Google e MFA.",
    };
  }
  if (browserSupported === false) {
    return {
      status: CAPABILITY_STATUS.UNSUPPORTED_BROWSER,
      reason: "Este navegador não oferece a API necessária para usar chaves de acesso.",
      alternative: "Use um navegador compatível ou continue com senha, Google e MFA.",
    };
  }
  return {
    status: CAPABILITY_STATUS.SUPPORTED,
    reason: "O navegador oferece chaves de acesso.",
    alternative: null,
  };
}

export function captureCapability(
  resource: "camera" | "microphone" | "screen",
  state: "supported" | "unsupported" | "permission_pending" | "granted" | "denied" | "cancelled" | "ended" | "error",
): CapabilityAssessment {
  const label = resource === "camera" ? "câmera" : resource === "microphone" ? "microfone" : "compartilhamento de tela";
  if (state === "denied") {
    return {
      status: CAPABILITY_STATUS.PERMISSION_DENIED,
      reason: `O navegador não possui acesso a ${label}.`,
      alternative: "Revise as permissões do site ou continue sem esse recurso quando permitido.",
    };
  }
  if (state === "unsupported") {
    return {
      status: CAPABILITY_STATUS.UNSUPPORTED_BROWSER,
      reason: `Este navegador não oferece ${label} para a Elyra.`,
      alternative: "Use outro navegador ou continue sem esse recurso quando permitido.",
    };
  }
  if (state === "error" || state === "ended") {
    return {
      status: CAPABILITY_STATUS.CAPABILITY_NOT_AVAILABLE,
      reason: `${label[0]?.toLocaleUpperCase("pt-BR")}${label.slice(1)} não está disponível agora.`,
      alternative: "Tente novamente ou continue sem esse recurso quando permitido.",
    };
  }
  if (state === "cancelled") {
    return {
      status: CAPABILITY_STATUS.NOT_CONFIGURED,
      reason: `O uso de ${label} não foi confirmado.`,
      alternative: "Você pode solicitar novamente ou continuar sem esse recurso.",
    };
  }
  return {
    status: CAPABILITY_STATUS.SUPPORTED,
    reason: state === "granted"
      ? `${label[0]?.toLocaleUpperCase("pt-BR")}${label.slice(1)} autorizado.`
      : `${label[0]?.toLocaleUpperCase("pt-BR")}${label.slice(1)} disponível.`,
    alternative: null,
  };
}

export const APPLE_SIGN_IN_CAPABILITY: CapabilityAssessment = {
  status: CAPABILITY_STATUS.EXTERNAL_CONFIGURATION_REQUIRED,
  reason: "Entrar com Apple ainda não está disponível porque a integração externa não foi configurada.",
  alternative: "Use senha, Google ou uma chave de acesso cadastrada.",
};
