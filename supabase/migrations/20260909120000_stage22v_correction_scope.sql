-- Stage 22-V - remediacao: a correcao pertence ao dominio da TRANSCRICAO,
-- e o alvo do feedback precisa existir na propria sessao.
--
-- Migration ADITIVA. A `20260909110000` ja foi publicada e nao e editada: o que
-- estava errado la e corrigido aqui, com `drop policy` + `create policy`.
--
-- ---------------------------------------------------------------------------
-- 1. FINDING HIGH - a correcao usava o scope de RESULTADO
-- ---------------------------------------------------------------------------
--
-- `transcript_corrections_select_professional` nasceu exigindo
-- `share_result_consent` + `multimodal_result`. Isso esta errado, e a regra que
-- ele viola e antiga e explicita:
--
--   "Profissional le transcricao somente com o scope proprio de transcricao.
--    Compartilhar o resultado nunca compartilha a transcricao."
--
-- `transcript_corrections` guarda `original_content` e `corrected_content`.
-- Isso **e** conteudo de transcricao. Um profissional autorizado apenas para
-- `multimodal_result` passava a ler a fala da pessoa por uma porta lateral que
-- a Stage 12 tinha fechado pela porta da frente.
--
-- `RESULT_SHARING != TRANSCRIPT_SHARING`.
--
-- ---------------------------------------------------------------------------
-- 2. SEGUNDO DEFEITO, ENCONTRADO AO CORRIGIR O PRIMEIRO: a janela temporal
-- ---------------------------------------------------------------------------
--
-- A policy publicada usava `professional_access_allowed(user_id, scope)`, que
-- e a forma **anterior a Era 3**. A forma canonica vigente para dados de sessao
-- e `professional_session_allowed_on(user_id, scope, session_id)`, que aplica o
-- recorte de janela: o profissional so alcanca sessoes dentro do periodo que a
-- pessoa compartilhou.
--
-- Com a funcao antiga, a correcao ignorava a janela e viajava para sessoes fora
-- do periodo compartilhado. Reutilizamos o mecanismo canonico existente em vez
-- de escrever uma segunda implementacao de janela.
--
-- ---------------------------------------------------------------------------
-- 3. TERCEIRO DEFEITO: a correcao sobrevivia a apagamento da transcricao
-- ---------------------------------------------------------------------------
--
-- A policy da transcricao exige `status = 'available'`. Quando a pessoa apaga a
-- transcricao, a deleção e final (`ELYRA_TRANSCRIPT_DELETION_IS_FINAL`) e o
-- profissional deixa de alcanca-la.
--
-- Mas `transcript_corrections` guarda a **propria copia** do texto - duplicacao
-- deliberada, para que a comparacao original/corrigido continue existindo como
-- proveniencia. Sem vinculo com o estado da transcricao, essa copia continuava
-- legivel pelo profissional depois de a pessoa ter apagado o original: o
-- apagamento parecia feito e nao era.
--
-- A duplicacao continua (o titular tem direito a ela, e o export do titular a
-- carrega). O que muda e a **visibilidade profissional**: ela acompanha a
-- transcricao, porque e dela que o texto veio.
--
-- Retencao/apagamento do titular e uma decisao; visibilidade profissional e
-- outra. Esta migration so mexe na segunda.

drop policy if exists transcript_corrections_select_professional
  on public.transcript_corrections;

create policy transcript_corrections_select_professional
on public.transcript_corrections for select to authenticated
using (
  -- Revogada nao viaja.
  transcript_corrections.revoked_at is null
  -- A correcao so e visivel enquanto a transcricao que a originou e visivel.
  -- Sem isto, apagar a transcricao deixava a copia dentro da correcao de pe.
  and exists (
    select 1 from public.session_transcripts transcript
    where transcript.session_id = transcript_corrections.session_id
      and transcript.user_id = transcript_corrections.user_id
      and transcript.status = 'available'
  )
  and exists (
    select 1 from public.multimodal_sessions session
    where session.id = transcript_corrections.session_id
      and session.user_id = transcript_corrections.user_id
      -- Consentimento de TRANSCRICAO, e nao de resultado.
      and session.share_transcript_consent
      -- Mecanismo canonico, com o recorte de janela da Era 3.
      and public.professional_session_allowed_on(
        transcript_corrections.user_id, 'multimodal_transcript',
        transcript_corrections.session_id
      )
  )
);

comment on table public.transcript_corrections is
  'Revisao humana da transcricao. Entidade SEPARADA: o original nunca e sobrescrito. Pertence ao dominio da TRANSCRICAO - visivel ao profissional somente sob multimodal_transcript, e nunca sob multimodal_result.';
