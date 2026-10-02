# Elyra

Elyra é uma plataforma de organização pessoal e acompanhamento profissional do bem-estar, desenvolvida como trabalho acadêmico e técnico concluído. Reúne registros pessoais, compartilhamento consentido, agenda e sessões em uma aplicação web responsiva.

**Caráter não clínico:** não realiza diagnóstico, prescrição ou atendimento de emergência. Registros e análises ajudam a organizar informações e não substituem avaliação profissional. O projeto não foi homologado para operação pública com usuários reais.

This repository is a sanitized public snapshot of the completed Elyra project.

## Produto

- Área pessoal: check-ins de humor, sono, diário, metas, ciclo e relatórios determinísticos.
- Área profissional: perfil, solicitação de verificação, pessoas acompanhadas e acesso limitado por permissões revogáveis e janelas temporais.
- Agenda: horários publicados por data, ajustes de disponibilidade, agendamentos e sessões, sem alterar retroativamente compromissos existentes.
- Sessões: notas, autorrelato e recursos multimodais; chamadas em tempo real dependem de infraestrutura LiveKit independente.
- Rede de apoio: lista, mapa e localização opcional. A base incluída é sintética, sem cadastro real de serviços homologado.
- Artigos: conteúdo editorial próprio com links às fontes e revisão humana versionada.
- IA: integração por HTTP com o Veltrix, serviço independente não distribuído aqui. A ausência do serviço é tratada explicitamente.
- Segurança: autenticação Supabase, recuperação de conta, MFA/TOTP, passkeys, bloqueio local e controles de acesso no banco e servidor.
- Offline: núcleo pessoal com IndexedDB, fila de sincronização e tratamento explícito de conflitos. Integrações remotas continuam dependentes de conexão.

As ilustrações desta versão são placeholders geométricos próprios. Nenhuma imagem de usuário ou filmagem está incluída.

## Stack e arquitetura

Next.js, React, TypeScript, Tailwind CSS, Supabase/PostgreSQL, Vitest e Playwright. MediaPipe e Transformers.js dão suporte ao processamento local de sinais e transcrição; MapLibre exibe o mapa; LiveKit suporta chamadas.

A aplicação separa interface, rotas de API, serviços e persistência. O servidor aplica consentimento e autorização; as políticas de segurança por linha no PostgreSQL restringem acesso aos dados. Chaves administrativas e credenciais de serviços ficam somente no servidor. Consulte [Arquitetura](docs/Architecture.md), [Produto](docs/Product.md), [Acompanhamento](docs/Professional-Care.md) e [Agenda](docs/Agenda.md).

## Executar localmente

Requisitos: Node.js 24, npm e Docker para o Supabase local. Nenhum acesso a infraestrutura hospedada é necessário para o núcleo pessoal.

```sh
npm ci
npm run supabase:start
npm run qa:env:local
npm run qa:db:guard
npm run qa:db:reset
npm run dev
```

**O reset apaga somente a instância local isolada declarada neste projeto.** Leia [Setup local](docs/Local-Setup.md) antes de executar. A API local usa a porta 54381, o PostgreSQL 54382 e a captura de e-mails 54384. O gerador de ambiente utiliza as chaves fornecidas pelo CLI local e não as imprime. Não copie credenciais de outro projeto.

A demonstração profissional requer `ELYRA_DEMO_PASSWORD` aleatória e exclusiva em `.env.local`, depois `npm run demo:professional -- --seed`. Todos os perfis criados são fictícios. Integrações de IA, OAuth, e-mail externo, modelos opcionais e chamadas têm configuração independente e não são ativadas pelos comandos acima.

## Verificar

```sh
npm run qa:public
npm run typecheck
npm run lint
npm test
npm run build
```

Testes de banco e navegador que escrevem fixtures são opt-in e exigem Supabase local isolado: [QA](docs/QA.md). A verificação estática não implica homologação de produção. Veja [Segurança](docs/Security.md), [IA e Veltrix](docs/AI-and-Veltrix.md) e [Limitações](docs/Known-Limitations.md).

## Licença e contribuição

Código disponibilizado sob [licença proprietária para visualização e avaliação](LICENSE). Não é uma licença open source: reutilização, modificação, redistribuição e uso comercial fora da permissão expressa exigem autorização prévia por escrito.

Consulte [avisos de terceiros](THIRD_PARTY_NOTICES.md), [política de segurança](SECURITY.md) e [contribuição](CONTRIBUTING.md). O projeto é apresentado como trabalho concluído, sem garantia de manutenção ou roadmap ativo.
