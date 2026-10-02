-- ---------------------------------------------------------------------------
-- Stage 22-V - detalhe temporal aceita o extrator que a Stage passou a usar
--
-- A `20260905100000_stage22v_visual_observation` moveu o conjunto de sinais para
-- `elyra-signals/v3` e atualizou o `check` de `extractor_version` em
-- `derived_features`, `session_signal_windows` e `session_modality_coverage` —
-- e passou direto por `session_transcript_segments`, que continuou aceitando
-- apenas `v1` e `v2`.
--
-- O servico grava o segmento com `FEATURE_EXTRACTOR_VERSION`, hoje
-- `elyra-signals/v3`. O banco recusava com `23514`, o servico degradava para
-- `temporal_detail_failed`, e a sessao seguia sem o detalhe temporal. A falha
-- era contida — a analise sobrevivia — e por isso silenciosa: nas tres sessoes
-- da homologacao fisica de 11/09 nenhum segmento foi persistido, e a tabela
-- estava vazia no banco inteiro.
--
-- O dado ja perdido nao volta: o texto por segmento so existia no cliente,
-- durante a sessao. Esta migration impede a proxima perda; ela nao repara as
-- anteriores, e nao finge reparar.
--
-- ADITIVA. Nenhuma linha e apagada, nenhuma tabela recriada, nenhuma policy
-- tocada. As versoes anteriores continuam validas: uma linha gravada por
-- `v1`/`v2` diz qual aritmetica a produziu, e reescrever isso apagaria
-- proveniencia real.
--
-- Enumeracao explicita, e nao prefixo com curinga: `elyra-signals/%` aceitaria
-- uma versao futura que ninguem revisou, que e exatamente o que o `check`
-- existe para impedir.
-- ---------------------------------------------------------------------------

alter table public.session_transcript_segments
  drop constraint if exists session_transcript_segments_extractor_version_check;
alter table public.session_transcript_segments
  add constraint session_transcript_segments_extractor_version_check
  check (extractor_version in (
    'elyra-signals/v1', 'elyra-signals/v2', 'elyra-signals/v3'
  ));

/*
  `elyra-visual/v1` fica **de fora**, de proposito.

  As outras tres tabelas aceitam o extrator visual porque guardam linhas que ele
  produz: sinal derivado, janela de sinal e cobertura de modalidade visual. Um
  segmento de transcricao nao tem versao visual — landmark nao produz texto — e
  aceitar essa versao aqui abriria espaco para uma linha cuja proveniencia seria
  impossivel.
*/

comment on column public.session_transcript_segments.extractor_version is
  'Versao do extrator que produziu o trecho. v3 e o conjunto atual (Stage 22-V); v1/v2 permanecem validos para linhas historicas.';
