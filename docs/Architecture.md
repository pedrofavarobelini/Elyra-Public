# Arquitetura

A Elyra usa Next.js App Router para interface e rotas HTTP. `src/app` contém páginas e handlers; `src/components` concentra componentes; `src/lib` reúne contratos, serviços, autorização e persistência. O banco PostgreSQL, a autenticação e o armazenamento usam Supabase. O schema reconstruível está em `supabase/migrations`; políticas de segurança por linha e funções SQL possuem testes em `supabase/tests`.

A identidade autenticada não é autorização suficiente: consentimento, capacidade profissional, vínculo, permissão de compartilhamento, validade temporal e escopo são verificados no servidor e no banco. Revogar compartilhamento deve impedir leituras futuras. A chave administrativa não é enviada ao navegador.

O núcleo pessoal mantém cache e outbox em IndexedDB. Ao reconectar, a sincronização valida sessão e conflitos; não simula sucesso ao perder resposta ou receber recusa. O service worker armazena recursos estáticos aprovados e a página offline; rotas autenticadas não são tratadas como conteúdo público.

Relatórios pessoais são determinísticos. IA é um consumidor de contrato HTTP separado: o frontend não recebe chaves de modelos e o backend Veltrix não está neste pacote. Chamadas usam LiveKit independente. Processamento de landmarks e transcrição pode ocorrer no dispositivo, mas requer modelos compatíveis e capacidade computacional.

Decisões estruturais relevantes: controle de acesso em camadas; compartilhamento mínimo; retenção limitada de mídia; processamento local quando possível; disponibilidade publicada por data; conteúdo editorial revisado por pessoa; indisponibilidade explícita quando uma integração não existe. O material público descreve contratos e módulos, sem documentação operacional de infraestrutura hospedada.
