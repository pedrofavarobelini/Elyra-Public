import coreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * Flat config nativo do eslint-config-next 16.
 * Nao usar FlatCompat: a v16 ja exporta flat config.
 */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",

      "public/vision/wasm/**",
      // Mesma razao: kernels do ONNX Runtime vendorizados por `asr:assets`.
      // Codigo gerado, de terceiro, que ninguem edita nem revisa em diff.
      "public/asr/runtime/**",
    ],
  },
  ...coreWebVitals,
  ...nextTypescript,
];

export default config;
