import "server-only";

import { createHmac } from "node:crypto";

/**
 * Nomes e chave derivados de (sessao, geracao) com segredos do servidor.
 * Nada disto e persistido: o banco guarda so a geracao. Nova geracao = nova
 * sala, nova chave; o nome da sala nao revela sessao, pessoa nem horario, e
 * nao e enumeravel sem o sal.
 */

function hmac(secret: string, label: string): Buffer {
  return createHmac("sha256", secret).update(label, "utf8").digest();
}

export function realtimeRoomName(salt: string, sessionId: string, generation: number): string {
  return `r_${hmac(salt, `room:${sessionId}:${generation}`).toString("base64url")}`;
}

/** Identidade opaca por (sessao, usuario): nada de nome, e-mail ou registro. */
export function realtimeIdentity(salt: string, sessionId: string, userId: string): string {
  return `p_${hmac(salt, `id:${sessionId}:${userId}`).subarray(0, 18).toString("base64url")}`;
}

/**
 * 32 bytes pseudoaleatorios por (sessao, geracao). O SDK deriva a chave de
 * midia com HKDF quando recebe bytes (`ExternalE2EEKeyProvider.setKey`).
 * O rotulo "e2ee:" separa o dominio desta chave do nome da sala.
 */
export function realtimeE2EEKey(secret: string, sessionId: string, generation: number): string {
  return hmac(secret, `e2ee:${sessionId}:${generation}`).toString("base64url");
}
