-- ---------------------------------------------------------------------------
-- Stage 22-V — proveniencia do reconhecimento de fala.
--
-- `session_transcripts.source` nasceu com um unico valor legal,
-- `on_device_speech_api`, porque a V1 tinha um unico motor: o reconhecedor
-- nativo do navegador (ADR-0005). A Stage 22-V acrescentou o Whisper local, e
-- o `default` da coluna continuou respondendo por ele — uma transcricao
-- produzida pelo Whisper era gravada dizendo que veio da API nativa.
--
-- Dois motores com qualidades, modos de falha e licencas diferentes nao podem
-- compartilhar um nome. Esta migration separa os dois e grava o suficiente para
-- reproduzir a execucao do Whisper.
--
-- PROVENANCE != ACCURACY: nada aqui afirma que a transcricao esta correta.
-- Nenhuma destas colunas e confianca, e nenhuma delas deve ser exibida como se
-- fosse.
--
-- Compatibilidade historica: `on_device_speech_api` continua legal e continua
-- sendo o `default`. As linhas antigas NAO sao reescritas como nativas, porque
-- nunca se observou qual motor as produziu — reescreve-las inventaria um fato.
-- ---------------------------------------------------------------------------

alter table public.session_transcripts
  drop constraint if exists session_transcripts_source_check;
alter table public.session_transcripts
  add constraint session_transcripts_source_check
  check (source in (
    -- Nao distinguido: linhas anteriores a esta migration.
    'on_device_speech_api',
    'native_speech_recognition',
    'local_whisper'
  ));

alter table public.session_transcripts
  add column if not exists asr_model text
    check (asr_model is null or char_length(asr_model) between 1 and 120),
  add column if not exists asr_quantization text
    check (asr_quantization is null or char_length(asr_quantization) between 1 and 40),
  add column if not exists asr_runtime text
    check (asr_runtime is null or char_length(asr_runtime) between 1 and 60),
  add column if not exists asr_runtime_version text
    check (asr_runtime_version is null or char_length(asr_runtime_version) between 1 and 40),
  add column if not exists asr_vad text
    check (asr_vad is null or char_length(asr_vad) between 1 and 60);

-- O Whisper local so e reproduzivel com o detalhe completo; o motor nativo nao
-- publica nenhum desses campos, e declarar um seria inventa-lo. O banco recusa
-- as duas formas de mentira, e nao apenas a primeira.
alter table public.session_transcripts
  drop constraint if exists session_transcript_provenance_shape;
alter table public.session_transcripts
  add constraint session_transcript_provenance_shape check (
    (source = 'local_whisper'
      and asr_model is not null
      and asr_quantization is not null
      and asr_runtime is not null
      and asr_runtime_version is not null
      and asr_vad is not null)
    or (source <> 'local_whisper'
      and asr_model is null
      and asr_quantization is null
      and asr_runtime is null
      and asr_runtime_version is null
      and asr_vad is null)
  );

comment on column public.session_transcripts.source is
  'Motor que produziu a transcricao. `on_device_speech_api` = anterior a Stage 22-V, motor nao distinguido. Proveniencia, nunca acuracia.';
