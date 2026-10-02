"use client";

/**
 * Fronteira WebAuthn da Elyra (ADR-0017).
 *
 * Este modulo nao conhece URL, chave ou sessao Supabase. Ele transforma as
 * opcoes JSON entregues pelo servidor, chama a API nativa do navegador e
 * devolve apenas a resposta publica assinada pelo autenticador.
 */

export type PasskeyOptionsJSON = Record<string, unknown> & {
  challenge: string;
  rpId?: string;
  user?: Record<string, unknown> & { id: string };
  excludeCredentials?: Array<Record<string, unknown> & { id: string }>;
  allowCredentials?: Array<Record<string, unknown> & { id: string }>;
};

export type PasskeyCredentialJSON = {
  id: string;
  rawId: string;
  type: "public-key";
  response: Record<string, unknown>;
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
  authenticatorAttachment?: AuthenticatorAttachment | null;
};

export type PasskeyClientErrorCode =
  | "unsupported"
  | "cancelled"
  | "invalid_origin"
  | "not_available"
  | "invalid_response";

export class PasskeyClientError extends Error {
  constructor(readonly code: PasskeyClientErrorCode) {
    super(code);
    this.name = "PasskeyClientError";
  }
}

function fromBase64Url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  return bytes.buffer;
}

function toBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function creationOptions(json: PasskeyOptionsJSON): PublicKeyCredentialCreationOptions {
  const parser = PublicKeyCredential as typeof PublicKeyCredential & {
    parseCreationOptionsFromJSON?: (value: unknown) => PublicKeyCredentialCreationOptions;
  };
  if (typeof parser.parseCreationOptionsFromJSON === "function") {
    return parser.parseCreationOptionsFromJSON(json);
  }
  if (!json.user) throw new PasskeyClientError("invalid_response");
  return {
    ...json,
    challenge: fromBase64Url(json.challenge),
    user: { ...json.user, id: fromBase64Url(json.user.id) },
    excludeCredentials: json.excludeCredentials?.map((credential) => ({
      ...credential,
      id: fromBase64Url(credential.id),
    })),
  } as PublicKeyCredentialCreationOptions;
}

function requestOptions(json: PasskeyOptionsJSON): PublicKeyCredentialRequestOptions {
  const parser = PublicKeyCredential as typeof PublicKeyCredential & {
    parseRequestOptionsFromJSON?: (value: unknown) => PublicKeyCredentialRequestOptions;
  };
  if (typeof parser.parseRequestOptionsFromJSON === "function") {
    return parser.parseRequestOptionsFromJSON(json);
  }
  return {
    ...json,
    challenge: fromBase64Url(json.challenge),
    allowCredentials: json.allowCredentials?.map((credential) => ({
      ...credential,
      id: fromBase64Url(credential.id),
    })),
  } as PublicKeyCredentialRequestOptions;
}

function registrationJSON(credential: PublicKeyCredential): PasskeyCredentialJSON {
  const native = credential as PublicKeyCredential & { toJSON?: () => PasskeyCredentialJSON };
  if (typeof native.toJSON === "function") return native.toJSON();
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: "public-key",
    response: {
      attestationObject: toBase64Url(response.attestationObject),
      clientDataJSON: toBase64Url(response.clientDataJSON),
      ...(typeof response.getTransports === "function" ? { transports: response.getTransports() } : {}),
    },
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment as AuthenticatorAttachment | null,
  };
}

function authenticationJSON(credential: PublicKeyCredential): PasskeyCredentialJSON {
  const native = credential as PublicKeyCredential & { toJSON?: () => PasskeyCredentialJSON };
  if (typeof native.toJSON === "function") return native.toJSON();
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: "public-key",
    response: {
      authenticatorData: toBase64Url(response.authenticatorData),
      clientDataJSON: toBase64Url(response.clientDataJSON),
      signature: toBase64Url(response.signature),
      ...(response.userHandle ? { userHandle: toBase64Url(response.userHandle) } : {}),
    },
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment as AuthenticatorAttachment | null,
  };
}

export function browserSupportsPasskeys(): boolean {
  return typeof window !== "undefined" &&
    typeof PublicKeyCredential !== "undefined" &&
    typeof navigator.credentials?.create === "function" &&
    typeof navigator.credentials?.get === "function";
}

function mapBrowserError(error: unknown): never {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    throw new PasskeyClientError("cancelled");
  }
  if (error instanceof DOMException && error.name === "SecurityError") {
    throw new PasskeyClientError("invalid_origin");
  }
  if (error instanceof DOMException && error.name === "NotSupportedError") {
    throw new PasskeyClientError("not_available");
  }
  throw new PasskeyClientError("invalid_response");
}

export async function createPasskey(options: PasskeyOptionsJSON): Promise<PasskeyCredentialJSON> {
  if (!browserSupportsPasskeys()) throw new PasskeyClientError("unsupported");
  try {
    const credential = await navigator.credentials.create({ publicKey: creationOptions(options) });
    if (!(credential instanceof PublicKeyCredential)) throw new PasskeyClientError("invalid_response");
    return registrationJSON(credential);
  } catch (error) {
    if (error instanceof PasskeyClientError) throw error;
    return mapBrowserError(error);
  }
}

export async function requestPasskey(options: PasskeyOptionsJSON): Promise<PasskeyCredentialJSON> {
  if (!browserSupportsPasskeys()) throw new PasskeyClientError("unsupported");
  try {
    const credential = await navigator.credentials.get({ publicKey: requestOptions(options) });
    if (!(credential instanceof PublicKeyCredential)) throw new PasskeyClientError("invalid_response");
    return authenticationJSON(credential);
  } catch (error) {
    if (error instanceof PasskeyClientError) throw error;
    return mapBrowserError(error);
  }
}
