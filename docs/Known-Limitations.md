# Limitações conhecidas

- Trabalho acadêmico/técnico concluído; não há compromisso de suporte ou desenvolvimento contínuo.
- Não homologado para operação pública com usuários reais; caráter não clínico.
- O código tem licença proprietária restrita à visualização e avaliação; outros usos exigem autorização por escrito.
- Veltrix é um backend independente ausente deste pacote. Mock também precisa desse serviço.
- OAuth, envio externo de e-mail e chamadas precisam de configuração e serviços independentes.
- Pesos de visão/transcrição e datasets reais não foram distribuídos. A capacidade depende de hardware, navegador e modelos específicos.
- A rede de apoio incluída é sintética. A publicação de uma base real exige validação de origem, atualização e direitos próprios.
- A suíte completa de banco tinha falhas documentadas em fixtures que assumem base vazia, incompatíveis com dados DEMO previamente carregados. Não foi reexecutada nesta construção; não há aprovação global de pgTAP aqui. Execute em instância descartável e interprete o resultado, sem bypass.
- Offline cobre o núcleo pessoal; não promete autenticação inicial ou serviços remotos sem conexão.
- Ícones e ilustrações são placeholders neutros próprios.
- Alertas remanescentes de ferramentas de desenvolvimento devem ser reavaliados antes de expor servidores de desenvolvimento ou fazer upgrades maiores. Leia [Dependency-Security.md](Dependency-Security.md).

A verificação de construção não substitui testes de integrações externas ou avaliação de privacidade e segurança em uma futura implantação.
