# Segurança

Autenticação é fornecida pelo Supabase. Recuperação de conta evita expor se um endereço existe; MFA/TOTP e passkeys acrescentam controles de autenticação. O bloqueio local protege a interface durante a sessão, mas não substitui expiração de sessão, autorização de API ou políticas de banco.

Dados pessoais e profissionais exigem consentimento e escopo. Acesso privilegiado é limitado ao servidor. Variáveis `NEXT_PUBLIC_*` são públicas por definição e nunca devem conter chave administrativa, senha, segredo de API ou chave de provider.

O projeto inclui proteções de origem, rate limiting, validação de entrada, armazenamento mínimo e controles de compartilhamento. Não registre diário, mídia, transcrição, cookies ou tokens em issues e logs. Não use perfis reais para validar a demo.

Use `.env.local` ignorado e credenciais novas. Scripts destrutivos de QA passam pelo guarda local, que valida identificador de projeto, portas loopback e ausência de link remoto. Não transforme esse guarda em bypass para banco hospedado.

Consulte [SECURITY.md](../SECURITY.md). Reportes usam o formulário privado de vulnerabilidades do GitHub, indicado na política de segurança. Scans estáticos e testes não substituem homologação de um ambiente real de produção.
