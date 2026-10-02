#!/usr/bin/env node
/**
 * LiveKit local da Elyra (PRO-7R, ADR-0025).
 *
 *   npm run realtime:start   sobe o servidor (Docker) e garante as envs no .env.local
 *   npm run realtime:stop    derruba o servidor
 *
 * Somente desenvolvimento/QA local. Producao (Cloud ou self-host) esta
 * DEFERRED. Nenhum segredo e impresso nem versionado: a chave local e gerada
 * aqui, uma vez por maquina, e guardada so no .env.local.
 *
 * `ELYRA_LIVEKIT_BIN=/caminho/livekit-server` usa o binario oficial em vez do
 * Docker (ex.: ambiente sem acesso ao Docker Hub).
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const ENV_FILE = resolve(ROOT, ".env.local");
const CONFIG = resolve(ROOT, "infra/livekit/livekit.local.yaml");
const IMAGE = "livekit/livekit-server:v1.13.7";
const CONTAINER = "elyra-livekit-local";
const PID_FILE = resolve(ROOT, ".demo/livekit.pid");

function log(event, fields = {}) {
  const extra = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(" ");
  console.log(`REALTIME=${event}${extra ? ` ${extra}` : ""}`);
}

function readEnv() {
  if (!existsSync(ENV_FILE)) return new Map();
  const map = new Map();
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) map.set(match[1], match[2]);
  }
  return map;
}

/** Acrescenta so o que falta; nunca sobrescreve nem imprime valor. */
function ensureEnv() {
  const env = readEnv();
  const wanted = {
    LIVEKIT_URL: "ws://localhost:7880",
    LIVEKIT_API_KEY: `elyra-local-${randomBytes(4).toString("hex")}`,
    LIVEKIT_API_SECRET: randomBytes(32).toString("base64url"),
    REALTIME_ROOM_SALT: randomBytes(32).toString("base64url"),
    REALTIME_E2EE_SECRET: randomBytes(32).toString("base64url"),
  };
  const missing = Object.entries(wanted).filter(([key]) => !env.get(key));
  if (missing.length > 0) {
    const prefix = existsSync(ENV_FILE) && !readFileSync(ENV_FILE, "utf8").endsWith("\n") ? "\n" : "";
    const block = missing.map(([k, v]) => `${k}=${v}`).join("\n");
    writeFileSync(ENV_FILE, (existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "") + prefix +
      "# PRO-7R — LiveKit local (gerado por npm run realtime:start; nao versionar)\n" + block + "\n");
    for (const [k, v] of missing) env.set(k, v);
  }
  log("ENV", { added: missing.length, keys: missing.map(([k]) => k).join(",") || "none" });
  return env;
}

function keysArg(env) {
  return `${env.get("LIVEKIT_API_KEY")}: ${env.get("LIVEKIT_API_SECRET")}`;
}

async function waitReady() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch("http://127.0.0.1:7880/");
      if (response.ok) return true;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function responding() {
  try {
    return (await fetch("http://127.0.0.1:7880/")).ok;
  } catch {
    return false;
  }
}

async function start() {
  const env = ensureEnv();
  // Ja no ar: nao sobe uma segunda instancia disputando as portas.
  if (await responding()) {
    log("READY", { url: "ws://localhost:7880", already: "true" });
    return;
  }
  const binary = process.env.ELYRA_LIVEKIT_BIN;
  if (binary) {
    mkdirSync(resolve(ROOT, ".demo"), { recursive: true });
    const out = openSync(resolve(ROOT, ".demo/livekit.log"), "a");
    const child = spawn(binary, ["--config", CONFIG], {
      detached: true,
      stdio: ["ignore", out, out],
      env: { ...process.env, LIVEKIT_KEYS: keysArg(env) },
    });
    child.unref();
    writeFileSync(PID_FILE, String(child.pid));
    log("STARTING", { mode: "binary" });
  } else {
    spawnSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
    const run = spawnSync("docker", [
      "run", "-d", "--name", CONTAINER,
      "-p", "127.0.0.1:7880:7880", "-p", "127.0.0.1:7881:7881",
      "-p", "127.0.0.1:50000-50100:50000-50100/udp",
      // So o NOME da variavel vai na linha de comando (visivel em `ps`); o
      // valor vem do ambiente deste processo.
      "-e", "LIVEKIT_KEYS",
      "-v", `${CONFIG}:/etc/livekit.yaml:ro`,
      IMAGE, "--config", "/etc/livekit.yaml", "--bind", "0.0.0.0", "--node-ip", "127.0.0.1",
    ], { encoding: "utf8", env: { ...process.env, LIVEKIT_KEYS: keysArg(env) } });
    if (run.status !== 0) {
      log("BLOCKED", { reason: "docker_run_failed" });
      process.exit(1);
    }
    log("STARTING", { mode: "docker", image: IMAGE });
  }
  if (!(await waitReady())) {
    log("BLOCKED", { reason: "not_ready" });
    process.exit(1);
  }
  log("READY", { url: "ws://localhost:7880" });
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Derruba de verdade: o LiveKit, com SIGTERM, drena participantes por tempo
 * indeterminado e segura as portas. Local/QA nao precisa de drenagem - o
 * `stop` tambem e o jeito de simular "provider caiu".
 */
async function stop() {
  if (existsSync(PID_FILE)) {
    const pid = Number(readFileSync(PID_FILE, "utf8"));
    if (alive(pid)) {
      process.kill(pid, "SIGTERM");
      for (let i = 0; i < 10 && alive(pid); i += 1) await new Promise((r) => setTimeout(r, 200));
      if (alive(pid)) process.kill(pid, "SIGKILL");
      for (let i = 0; i < 25 && alive(pid); i += 1) await new Promise((r) => setTimeout(r, 200));
    }
    rmSync(PID_FILE, { force: true });
  }
  spawnSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
  log("STOPPED");
}

const command = process.argv[2];
if (command === "start") await start();
else if (command === "stop") await stop();
else {
  console.error("uso: node scripts/realtime.mjs start|stop");
  process.exit(2);
}
