# IA e Veltrix

A Elyra consome o Veltrix por HTTP com contrato autenticado pelo servidor. O serviço de IA é independente e não está distribuído neste snapshot. Os nomes `PEDROCORE_*` são identificadores técnicos do contrato implementado, preservados para compatibilidade.

`PEDROCORE_PROVIDER_MODE=mock` pede uma resposta determinística ao serviço; continua sendo uma chamada HTTP real e exige Veltrix em execução. Não significa que `npm ci` instala um backend de IA. O modo real exige opt-in explícito, credencial no serviço e controles de ambiente; essas credenciais não pertencem ao frontend.

Sem serviço, chave ou evidência, a aplicação recusa o recurso de forma explícita. IA não publica artigos, verifica profissionais nem decide diagnóstico. Respostas geradas são auxiliares e precisam ser interpretadas dentro do caráter não clínico do produto.

MediaPipe e Transformers.js são bibliotecas, não concessões automáticas de direito de redistribuição de pesos, datasets ou conteúdo. Modelos não estão incluídos. Scripts opcionais de download fixam origem e hash; antes de redistribuir um modelo, verifique sua licença específica. Processamento local de mídia não autoriza enviar conteúdo pessoal a terceiros.
