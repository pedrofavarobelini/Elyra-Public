# Execução local

Use Node.js 24 e npm. Docker deve estar disponível para Supabase local. Trabalhe em uma pasta própria; não reutilize `.env.local` de outro projeto. Os comandos de banco abaixo escrevem apenas na instância local deste pacote e nunca devem apontar para ambiente hospedado.

1. Execute `npm ci`.
2. Execute `npm run supabase:start`. O CLI incluído é usado localmente; o projeto é `elyra-public-snapshot-local`, API 54381, PostgreSQL 54382, captura de e-mails 54384. O script reduz serviços opcionais para a execução básica.
3. Execute `npm run qa:env:local`. O gerador lê o status do CLI deste projeto e escreve `.env.local` ignorado, sem imprimir as chaves.
4. Execute `npm run qa:db:guard`. Se houver link remoto, porta errada ou identificador diferente, ele recusa.
5. Para banco descartável novo, execute `npm run qa:db:reset`: **apaga dados somente dessa instância local** e aplica migrations e seed local. Nunca execute contra dados que deseja preservar.
6. Execute `npm run dev` e abra `http://localhost:3000`.
7. Para conferir, execute `npm run qa:public`, `npm run typecheck`, `npm run lint`, `npm test` e `npm run build`.

A criação de conta com confirmação usa a captura de e-mails local. Para a demo profissional, gere uma senha aleatória nova com `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"` e configure `ELYRA_DEMO_PASSWORD` em `.env.local`. O resultado é exclusivamente local; não o reutilize em contas reais. Rode `npm run demo:professional -- --seed`, entre como `public.professional@demo.invalid` com a senha que configurou, e use `--check` para validar a fixture. `--drop` remove somente a demo; `--show` não imprime a senha.

Para E2E, defina também `ELYRA_QA_CANONICAL_PASSWORD` com valor aleatório local. `npm run qa:db:test` e `npm run qa:e2e` são opt-in e dependem do banco e suas fixtures. Não trate preflight recusado como aprovação. Resultados vão para `test-results`, nunca para esta documentação.

Integrações opcionais: Veltrix requer backend próprio; OAuth requer cadastro no provedor; Brevo requer credencial e remetente autorizado; LiveKit requer serviço próprio (`npm run realtime:start` gera ambiente local); modelos de ASR e visão são downloads opt-in e não foram incluídos ou testados como binários redistribuídos. Nenhum desses serviços é necessário para compilar e rodar os testes unitários.

`npm run build` prepara o worker MapLibre a partir do pacote instalado e pode buscar a fonte Inter via `next/font`. Rede para registro npm e fonte pode ser necessária na primeira instalação/build. O pacote de fontes e os mapas têm avisos em [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
