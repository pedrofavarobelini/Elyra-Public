# Auditoria de dependências do snapshot

Auditoria em 02/10/2026. Árvore final: 1 critical, 4 high e 3 moderate (8 entradas npm, não 8 CVEs independentes). `npm audit` retorna 1 por findings, não por falha de instalação. `npm audit --omit=dev`: 0 critical, 2 high e 0 moderate; ambos pertencem à cadeia Transformers → sharp.

Correção aplicada somente aqui: Next 16.3.5 → 16.3.8 e eslint-config-next → 16.3.8. O crítico Next foi removido da auditoria. Não foi usado audit fix force.

| Package / versão | Severidade | Direta/transitiva | Camada | Reachable | Exploitável nesta configuração | Fix / risco | Ação |
|---|---|---|---|---|---|---|---|
| @huggingface/transformers 3.7.6 | high | DIRECT | RUNTIME | NO_FOR_VULNERABLE_NATIVE_IMAGE_PATH | NO_OBSERVED_CHAIN | @huggingface/transformers 4.3.0 / major | ACCEPTABLE_WITH_DISCLOSURE |
| @vitest/mocker 2.1.9 | moderate | TRANSITIVE | DEV | NO_PUBLIC_MOCK_SERVER | NO_IN_RUN_CONFIGURATION | vitest 5.0.3 / major | DEV_ONLY |
| brace-expansion 1.1.18, 5.0.9 | high | TRANSITIVE | DEV_BUILD | LOCAL_TRUSTED_GLOBS_ONLY | NO_UNTRUSTED_HTTP_PATH | Disponível / atualização de lock sem major | DEV_ONLY |
| esbuild 0.21.5 | moderate | TRANSITIVE | DEV | NO_ESBUILD_SERVE | NO_IN_CURRENT_APP | vitest 5.0.3 / major | DEV_ONLY |
| sharp 0.34.5 | high | TRANSITIVE | RUNTIME_TRANSITIVE | NO_FOR_NESTED_COPY | NO_OBSERVED_CHAIN | @huggingface/transformers 4.3.0 / major | ACCEPTABLE_WITH_DISCLOSURE |
| vite 5.4.21 | high | TRANSITIVE | DEV | NO_PUBLIC_VITE_SERVER | NO_IN_CURRENT_APP | vitest 5.0.3 / major | DEV_ONLY |
| vite-node 2.1.9 | moderate | TRANSITIVE | DEV | NO_PUBLIC_VITE_SERVER | NO_IN_CURRENT_APP | vitest 5.0.3 / major | DEV_ONLY |
| vitest 2.1.9 | critical | DIRECT | DEV | NO_UI_API_LISTENER | NO_IN_RUN_CONFIGURATION | vitest 5.0.3 / major | DEV_ONLY |

## Evidência e limites

- **@huggingface/transformers**: Herda sharp nativo. Import dinâmico somente em carregamento ASR iniciado no navegador; pipeline automatic-speech-recognition, não processamento servidor de imagem enviada. Major 4.3.0 exige validar contratos/proveniência ASR.
- **@vitest/mocker**: Usado pela suíte local; não há servidor de mock exposto. Upgrade acompanha Vitest.
  Fontes: [advisory oficial](https://github.com/advisories/GHSA-82fw-gwwq-j7x9).
- **brace-expansion**: ESLint/TypeScript/minimatch sobre arquivos e padrões locais controlados; não recebe glob de request. Fix disponível sem major, recomendado em manutenção específica com nova validação.
  Fontes: [advisory oficial](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p), [advisory oficial](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [advisory oficial](https://github.com/advisories/GHSA-qhr7-859c-m2p7).
- **esbuild**: Transformação local; não usa esbuild.serve. Advisory de servidor não está habilitado.
  Fontes: [advisory oficial](https://github.com/advisories/GHSA-67mh-4wv8-2f99).
- **sharp**: A cópia vulnerável 0.34.5 está dentro de Transformers. Nenhum handler importa essa cópia para decodificar imagem de usuário. Sharp do framework/gerador é 0.35.4 corrigido. Reavaliar se surgir execução Node de Transformers ou upload processado por sharp.
  Fontes: [advisory oficial](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), [advisory oficial](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).
- **vite**: Aplicação usa Next. Vite aparece apenas na toolchain de Vitest; nenhum vite serve/launchEditor foi iniciado. Não expor servidor de desenvolvimento.
  Fontes: [advisory oficial](https://github.com/advisories/GHSA-4w7w-66w2-5vf9), [advisory oficial](https://github.com/advisories/GHSA-fx2h-pf6j-xcff), [advisory oficial](https://github.com/advisories/GHSA-v6wh-96g9-6wx3).
- **vite-node**: Herda Vite da ferramenta de testes; não integra servidor do produto.
- **vitest**: vitest run; UI/API desabilitadas e @vitest/ui ausente. Não expor UI/servidor de desenvolvimento. Upgrade 5.0.3 é major.
  Fontes: [advisory oficial](https://github.com/advisories/GHSA-5xrq-8626-4rwp), [advisory oficial](https://github.com/advisories/GHSA-82fw-gwwq-j7x9).

Fontes complementares: [Next corrigido](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j), [Vitest UI](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp), [sharp/libvips](https://github.com/lovell/sharp/security/advisories/GHSA-f88m-g3jw-g9cj).

Evidência de código: `src/lib/speech/browser-runtime.ts` importa Transformers dentro de loadAsrSession; configura modelos locais e pipeline ASR. `src/components/asr-model-comparison.tsx` é client e inicia preparação por gesto. `src/lib/speech/preparation.ts` encapsula loaders; não há handler servidor que processe imagem através da cópia sharp aninhada. O export condicional do pacote fornece transformers.web.js para navegador e transformers.node.mjs para Node. `next.config.ts` externaliza os binários; isso isoladamente não prova inacessibilidade: a conclusão depende dos chamadores client e da ausência do caminho servidor.

**RUNTIME_BLOCKERS = 0_IDENTIFIED_IN_CURRENT_CONFIGURATION**; **ACCEPTED_WITH_EVIDENCE = 8**, incluindo 6 dev e 2 entradas na mesma cadeia nativa não acionada por imagem no servidor. Os oito alertas continuam no lock: não é uma árvore sem vulnerabilidades. A avaliação é de alcance estático da configuração atual, sem execução de exploração ou homologação externa. Mudança de chamador, servidor de ferramenta exposto ou pipeline de imagem exige reclassificação antes de deploy.
