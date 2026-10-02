

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MODEL = resolve(process.cwd(), "public/asr/vad/silero_vad.onnx");
const MODEL_SHA256 =
  "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3";

const SAMPLE_RATE = 16_000;
const WINDOW = 512;
const CONTEXT = 64;
/** Padrao do Silero, e o mesmo usado em `segment-acceptance.ts`. */
const THRESHOLD = 0.5;


const FIXTURE_SEED = 0x22_05_0e;

/**
 * PRNG determinista (mulberry32).
 *
 * Pequeno, sem dependencia, e reproduzivel em qualquer runtime: o requisito aqui
 * nao e qualidade estatistica de gerador criptografico, e sim que a mesma semente
 * produza sempre exatamente a mesma sequencia.
 */
function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


/*
  `rng` vem **antes** de `i` para que as fixtures que nao dependem do indice
  possam simplesmente omitir o segundo parametro, em vez de carregar um
  argumento inutil so para satisfazer a assinatura.
*/
const FIXTURES = {
  "A. silencio digital": () => 0,
  "B. ruido baixo de sala": (rng) => (rng() - 0.5) * 0.002,
  "C. ventilador": (rng, i) =>
    0.05 * Math.sin((2 * Math.PI * 120 * i) / SAMPLE_RATE) + (rng() - 0.5) * 0.01,
  "D. teclado": (rng, i) => (i % 4000 < 60 ? (rng() - 0.5) * 0.8 : 0),
  "E. impacto curto": (rng, i) => (i < 800 ? (rng() - 0.5) * 0.9 : 0),
  "F. musica (tom que virou [musica])": (rng, i) =>
    0.25 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE),
  "G. ruido humano curto (tosse)": (rng, i) =>
    i > 8000 && i < 12000 ? (rng() - 0.5) * 0.5 : 0,
};

/**
 * Gera a fixture. A semente e recriada por fixture, entao a ordem de iteracao
 * nao altera o audio de nenhuma delas.
 */
function buildFixture(generator) {
  const rng = mulberry32(FIXTURE_SEED);
  const audio = new Float32Array(SAMPLE_RATE * 3);
  for (let i = 0; i < audio.length; i += 1) audio[i] = generator(rng, i);
  return audio;
}

/** Digest da fixture, para provar que a entrada e a mesma entre execucoes. */
function fixtureDigest(audio) {
  return createHash("sha256").update(Buffer.from(audio.buffer)).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(`assertion_failed:${message}`);
}

async function main() {
  if (!existsSync(MODEL)) {
    console.error("ASR_GUARDRAILS=BLOCKED reason=vad_model_missing");
    console.error("Rode `npm run asr:assets` antes.");
    process.exit(1);
  }

  const digest = createHash("sha256").update(readFileSync(MODEL)).digest("hex");
  assert(digest === MODEL_SHA256, `vad_model_digest_${digest}`);

  const ort = await import("onnxruntime-node");
  const session = await ort.InferenceSession.create(MODEL);

  let worst = 0;
  const rejected = [];
  const digests = [];

  for (const [name, generator] of Object.entries(FIXTURES)) {
    const audio = buildFixture(generator);
    const inputDigest = fixtureDigest(audio);

    /*
      Prova de determinismo **dentro** da execucao: a fixture e reconstruida do
      zero e precisa dar o mesmo digest. Somada a semente fixa, isso garante que
      duas execucoes consecutivas medem exatamente o mesmo audio.
    */
    assert(
      fixtureDigest(buildFixture(generator)) === inputDigest,
      `${name}_fixture_not_deterministic`,
    );
    digests.push(`${inputDigest.slice(0, 16)}  ${name}`);

    let state = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
    let context = new Float32Array(CONTEXT);
    const probabilities = [];
    for (let offset = 0; offset + WINDOW <= audio.length; offset += WINDOW) {
      const modelInput = new Float32Array(CONTEXT + WINDOW);
      modelInput.set(context, 0);
      modelInput.set(audio.subarray(offset, offset + WINDOW), CONTEXT);
      const output = await session.run({
        input: new ort.Tensor("float32", modelInput, [1, modelInput.length]),
        state,
        sr: new ort.Tensor("int64", BigInt64Array.from([BigInt(SAMPLE_RATE)]), []),
      });
      probabilities.push(output.output.data[0]);
      state = output.stateN;
      context = modelInput.slice(-CONTEXT);
    }

    const max = Math.max(...probabilities);
    const above = probabilities.filter((p) => p >= THRESHOLD).length;
    worst = Math.max(worst, max);

    console.log(
      `${name.padEnd(38)} p_max=${max.toFixed(4).padStart(7)}  janelas>=${THRESHOLD}: ${above}/${probabilities.length}  sha=${inputDigest.slice(0, 12)}`,
    );

    // Nenhuma janela pode ser marcada como fala: o trecho nem chega ao Whisper.
    assert(above === 0, `${name}_reached_asr`);
    rejected.push(name);
  }

  console.log("");
  console.log("");
  for (const line of digests) console.log(`fixture ${line}`);
  console.log("");
  console.log(
    [
      "ASR_GUARDRAILS=PASS",
      `VAD_MODEL=silero_vad_v5`,
      `VAD_SHA256_OK=true`,
      "ASR_GUARDRAIL_FIXTURES_DETERMINISTIC=YES",
      `FIXTURE_SEED=0x${FIXTURE_SEED.toString(16)}`,
      `NON_SPEECH_FIXTURES_REJECTED=${rejected.length}/${Object.keys(FIXTURES).length}`,
      `WORST_NON_SPEECH_PROBABILITY=${worst.toFixed(4)}`,
      `THRESHOLD=${THRESHOLD}`,
      "SILENCE_REACHES_ASR=0",
      "FABRICATED_SENTENCE_COUNT=0",
      "SPEECH_ACCEPTANCE_PROVEN_HERE=NO_REQUIRES_HUMAN_VOICE",
    ].join(" "),
  );
}

main().catch((error) => {
  console.error(`ASR_GUARDRAILS=FAIL ${error?.message ?? error}`);
  process.exitCode = 1;
});
