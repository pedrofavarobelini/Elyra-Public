# Verificação

A verificação pública é independente de infraestrutura hospedada. `npm run qa:public` confere links internos, template de ambiente, ausência de arquivo Git quando usado com `--filesystem-only` e de dumps/evidências internas no payload. `npm run typecheck` gera tipos de rotas e valida TypeScript; `npm run lint` confere qualidade; `npm test` executa Vitest; `npm run build` valida o build de produção.

Vitest cobre contratos, autorização, consentimento, grants, agenda, sincronização offline, segurança, relatórios e identidade sintética da demo. O teste `PUBLIC_DEMO_OWNER_DATA = 0` exige e-mails de fixture explícitos, digest calculado a partir da fixture pública e ausência de senha fixa, preservando o guarda local antes do cliente administrativo.

Testes de banco PostgreSQL/pgTAP e Playwright que escrevem fixtures são opt-in: use somente Supabase local isolado, migrations e credenciais geradas nesse ambiente. Os comandos de QA mantêm preflight; uma recusa não é sucesso. Esses testes não dependem de credenciais reais ou infraestrutura hospedada por terceiros.

Scans de texto, binários e manifesto complementam a verificação. Ferramentas especializadas de segredo devem ser executadas antes de publicação quando disponíveis. O resumo público descreve método e cobertura; não contém dumps, screenshots de contas, tokens ou logs brutos.

Este conjunto não homologa implantação de produção, modelos externos, envio de e-mail real ou chamadas externas. Resultados obtidos nesta construção estão resumidos em [Validation-Results.md](Validation-Results.md).

A suite completa de pgTAP possui falhas históricas documentadas em fixtures de identidade, descoberta profissional e rede de apoio quando a base já contém DEMO. Isso não recebeu aprovação global e não foi reexecutado neste snapshot. Banco e E2E permanecem opt-in, com resultado independente dos checks estáticos.
