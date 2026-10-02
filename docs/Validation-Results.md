# Resultados da construção

Verificado em 02/10/2026, em cópia isolada dos arquivos declarados, sem credenciais, banco ou serviços hospedados. O pacote fonte permanece separado de node_modules, build e resultados de teste.

| Verificação | Resultado |
|---|---|
| npm ci | PASS, exit 0 |
| TypeScript | PASS, exit 0 |
| ESLint | PASS, exit 0, zero erros e warnings no conteúdo final |
| Build de produção | PASS, exit 0, Next 16.3.8 |
| Vitest completo | PASS, exit 0, 2.321 aprovados e 7 externos opt-in ignorados; 193 arquivos aprovados e 1 externo ignorado |
| QA documental e template | PASS, links locais válidos e placeholders |
| Guarda de banco | PASS para identificador e portas locais isolados; não equivale a teste de conexão ou migrations |
| Smoke HTTP/navegador | PASS para 9 recursos públicos e página offline, sem banco; zero erros JavaScript na página verificada |
| Segredos e dados conhecidos do titular | Nenhuma correspondência detectada nos padrões e identificadores auditados |
| Binários | 3 PNGs próprios, metadata vazia; nenhum peso neural, vídeo, screenshot ou documento binário |
| Dependências | 1 critical, 4 high, 3 moderate; alcance e condições em Dependency-Security.md |

Os 7 skips são de integração Veltrix opt-in. Não foram executados pgTAP completo, reset/seed, E2E autenticado com Supabase nem serviços externos. A limitação histórica da suíte completa de banco está em Known-Limitations.md. Ferramentas gitleaks e trufflehog não estavam instaladas; buscas estruturadas e comparação de identificadores conhecidos foram utilizadas, sem garantia contra todo possível segredo não reconhecido.

A validação não homologa produção. A licença proprietária está em LICENSE e o canal privado está em SECURITY.md; esta disponibilização pública é destinada à visualização e avaliação.
