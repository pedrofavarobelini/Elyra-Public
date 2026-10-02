/**
 * `onnxruntime-web` publica tipos em `types.d.ts`, mas o mapa de `exports` do
 * pacote nao os alcanca — o TypeScript resolve o bundle `.mjs` e cai em
 * `implicitly any`.
 *
 * A declaracao existe so para o `import()` dinamico compilar. O contrato de
 * verdade e `OrtLike`, em `browser-runtime.ts`: uma superficie minima e
 * explicita, com os tres membros que realmente usamos. Declarar o modulo aqui e
 * casta-lo la e mais honesto do que fingir que consumimos a tipagem completa.
 */
declare module "onnxruntime-web";
