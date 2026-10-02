"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  REALTIME_UNAVAILABLE_COPY,
  type SessionMediaEvent,
  type SessionMediaGrant,
} from "@/lib/contracts/professional-sessions";

import { IDLE_CALL, createCallAdapter, type CallAdapter, type CallDevices } from "./call-adapter";

/**
 * Orquestra Elyra <-> provider para uma sessao (PRO-7R).
 *
 * - Entrar: a Elyra autoriza (banco refaz todos os gates) e so entao o adapter
 *   conecta com o token curto e a chave E2EE da geracao.
 * - Durante a chamada: heartbeat a cada `heartbeatSeconds` (30 s). Recusa =>
 *   desconecta na hora e mostra o motivo; geracao nova => a sala antiga morreu,
 *   reentra com token e chave novos.
 * - Queda: a reconexao curta e do provider; queda completa volta a pedir
 *   token a Elyra, e se a Elyra recusa, nao reconecta.
 * - Nada de token/chave em estado React, URL, storage ou log.
 */

export type SessionCallNotice = { kind: "denied" | "unavailable" | "info"; text: string } | null;

async function postMedia(sessionId: string, body: unknown): Promise<SessionMediaGrant> {
  const response = await fetch(`/api/professional-sessions/${sessionId}/media`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { data?: SessionMediaGrant; error?: string };
  if (!response.ok || !payload.data) {
    throw new Error(response.status === 503 ? REALTIME_UNAVAILABLE_COPY : (payload.error ?? REALTIME_UNAVAILABLE_COPY));
  }
  return payload.data;
}

function reportEvent(sessionId: string, event: SessionMediaEvent) {
  // Trilha e metadado: falha aqui nunca derruba a chamada.
  void fetch(`/api/professional-sessions/${sessionId}/media`, {
    method: "PUT",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event }),
  }).catch(() => undefined);
}

const noopSubscribe = () => () => undefined;
const idle = () => IDLE_CALL;

export function useSessionCall(sessionId: string) {
  const [adapter] = useState<CallAdapter | null>(() => (typeof window === "undefined" ? null : createCallAdapter()));
  const snapshot = useSyncExternalStore(
    adapter?.subscribe ?? noopSubscribe,
    adapter?.getSnapshot ?? idle,
    idle,
  );
  const [notice, setNotice] = useState<SessionCallNotice>(null);
  const [joining, setJoining] = useState(false);
  const generation = useRef<number | null>(null);
  const heartbeatSeconds = useRef(30);
  const devices = useRef<CallDevices>({ audio: true, video: true });
  const wasReconnecting = useRef(false);

  const join = useCallback(
    async (chosen?: CallDevices) => {
      if (!adapter) return false;
      if (chosen) devices.current = chosen;
      setJoining(true);
      setNotice(null);
      try {
        const grant = await postMedia(sessionId, { purpose: "join" });
        if (grant.status === "denied") {
          setNotice({ kind: "denied", text: grant.message });
          return false;
        }
        if (!grant.join) throw new Error(REALTIME_UNAVAILABLE_COPY);
        generation.current = grant.generation;
        heartbeatSeconds.current = grant.heartbeatSeconds;
        await adapter.connect(grant.join, devices.current);
        if (adapter.getSnapshot().state === "connected") {
          reportEvent(sessionId, "joined");
          return true;
        }
        return false;
      } catch (caught) {
        setNotice({ kind: "unavailable", text: caught instanceof Error ? caught.message : REALTIME_UNAVAILABLE_COPY });
        return false;
      } finally {
        setJoining(false);
      }
    },
    [adapter, sessionId],
  );

  const leave = useCallback(async () => {
    if (!adapter) return;
    const inCall = adapter.getSnapshot().state !== "idle" && adapter.getSnapshot().state !== "disconnected";
    await adapter.disconnect();
    generation.current = null;
    if (inCall) reportEvent(sessionId, "left");
  }, [adapter, sessionId]);

  /** Encerramento imposto pela Elyra (recusa, sessao fechada na tela). */
  const terminate = useCallback(
    async (text: string) => {
      if (!adapter) return;
      await adapter.disconnect();
      generation.current = null;
      setNotice({ kind: "denied", text });
    },
    [adapter],
  );

  const live = snapshot.state === "connected" || snapshot.state === "reconnecting" || snapshot.state === "unstable";

  // Revalidacao proporcional: so durante a chamada e com a aba visivel ou nao
  // (revogacao nao pode esperar a pessoa voltar para a aba).
  useEffect(() => {
    if (!live || !adapter) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const grant = await postMedia(sessionId, { purpose: "heartbeat" });
        if (cancelled) return;
        if (grant.status === "denied") {
          await terminate(grant.message);
        } else if (generation.current !== null && grant.generation !== generation.current) {
          // Sala antiga revogada (ex.: vinculo pausado e retomado): entra de novo
          // com token e chave da geracao nova.
          await adapter.disconnect();
          await join();
        }
      } catch {
        // Falha de rede no heartbeat: o provider segue; a proxima tentativa decide.
      }
    }, heartbeatSeconds.current * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [adapter, join, live, sessionId, terminate]);

  // Reconexao concluida pelo provider entra na trilha como metadado.
  useEffect(() => {
    if (snapshot.state === "reconnecting") wasReconnecting.current = true;
    else if (snapshot.state === "connected" && wasReconnecting.current) {
      wasReconnecting.current = false;
      reportEvent(sessionId, "reconnected");
    }
  }, [sessionId, snapshot.state]);

  // Queda completa (sala fechada pelo servidor ou rede): pergunta a Elyra
  // antes de qualquer reentrada. Recusa => mostra o motivo e nao reconecta.
  useEffect(() => {
    if (snapshot.failure !== "room_closed") return;
    let cancelled = false;
    void postMedia(sessionId, { purpose: "heartbeat" })
      .then((grant) => {
        if (cancelled) return;
        // Recusa: nada de "entrar de novo" no palco; o motivo fica visivel.
        if (grant.status === "denied") void terminate(grant.message);
        else setNotice({ kind: "info", text: "A chamada caiu. Você pode entrar de novo." });
      })
      .catch(() => {
        if (!cancelled) setNotice({ kind: "unavailable", text: "A chamada caiu e a Elyra não respondeu. Tente de novo." });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, snapshot.failure, terminate]);

  // Sair da pagina encerra a midia.
  useEffect(() => () => void adapter?.disconnect(), [adapter]);

  return { adapter, snapshot, notice, joining, join, leave, terminate, live };
}
