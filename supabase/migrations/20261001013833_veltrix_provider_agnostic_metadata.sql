-- ===========================================================================
-- Veltrix provider-agnostic metadata (ADR-0034)
--
-- `provider_used` e `model` sao METADATA DE AUDITORIA da inferencia: registram
-- o que o Veltrix declarou ter usado. A escolha do provider externo pertence ao
-- Veltrix (catalogo + homologacao + matriz de autorizacao por projeto). A Elyra
-- nao decide nem autoriza provider pelo nome, entao nao pode codificar a lista
-- de providers no banco: com um segundo provider homologado pelo Veltrix, uma
-- insercao legitima falharia aqui.
--
-- O que muda: a lista fechada ('mock', 'gemini') vira um formato fechado de
-- identificador, com os pseudo-providers do Veltrix explicitamente recusados.
-- O que NAO muda: mock continua amarrado a mock-v1; fallback continua proibido;
-- contrato/output/correlation continuam fechados.
--
-- Nao destrutiva: nenhuma linha e apagada ou reescrita. Os mesmos nomes de
-- constraint sao mantidos. Toda linha existente ('mock'/'mock-v1' e
-- 'gemini'/'gemini-3.5-flash') satisfaz o novo predicado, entao a validacao do
-- ADD CONSTRAINT nao pode falhar por dado preexistente.
-- ===========================================================================

-- ai_insights ---------------------------------------------------------------

alter table public.ai_insights
  drop constraint ai_insights_provider_used_check;

alter table public.ai_insights
  add constraint ai_insights_provider_used_check check (
    provider_used ~ '^[a-z][a-z0-9_-]{1,31}$'
    and provider_used not in ('none', 'unknown', 'auto', 'local', 'local_qa', 'local_model')
  );

alter table public.ai_insights
  drop constraint ai_insights_provider_model_check;

alter table public.ai_insights
  add constraint ai_insights_provider_model_check check (
    (provider_used = 'mock' and model = 'mock-v1')
    or (
      provider_used <> 'mock'
      and model <> 'mock-v1'
      and model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$'
    )
  );

comment on constraint ai_insights_provider_used_check on public.ai_insights is
  'Formato de identificador de provider declarado pelo Veltrix (ADR-0034). Nao e lista de providers autorizados: autorizacao pertence ao Veltrix.';
comment on constraint ai_insights_provider_model_check on public.ai_insights is
  'mock exige mock-v1; provider real nunca declara o modelo simulado (ADR-0034).';

-- session_interpretations ---------------------------------------------------

alter table public.session_interpretations
  drop constraint session_interpretations_provider_used_check;

alter table public.session_interpretations
  add constraint session_interpretations_provider_used_check check (
    provider_used ~ '^[a-z][a-z0-9_-]{1,31}$'
    and provider_used not in ('none', 'unknown', 'auto', 'local', 'local_qa', 'local_model')
  );

-- Deliberadamente SEM nova amarracao provider/model aqui: esta tabela nunca a
-- teve, e acrescenta-la agora seria um aperto (nao um alivio) validado contra
-- dado vivo. O formato do modelo continua limitado por
-- session_interpretations_model_check (1..80 caracteres).

comment on constraint session_interpretations_provider_used_check on public.session_interpretations is
  'Formato de identificador de provider declarado pelo Veltrix (ADR-0034). Nao e lista de providers autorizados: autorizacao pertence ao Veltrix.';
