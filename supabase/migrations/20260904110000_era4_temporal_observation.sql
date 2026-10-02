-- Era 4 / 22B - observacao temporal.
--
-- **A lacuna.** Ate aqui tudo era agregado da sessao inteira. Os vetores
-- temporais existiam durante a captura - envoltoria RMS a cada 100 ms, diferenca
-- de quadro a cada 200 ms - e eram reduzidos a seis escalares antes de qualquer
-- persistencia. A frase "essa mudanca aconteceu enquanto ela falava sobre X" era
-- inexprimivel pelo sistema.
--
-- **O que passa a existir.** Janelas derivadas, e segmentos de transcricao com o
-- instante em que o reconhecedor os finalizou.
--
-- **O que NAO passa a existir.** Envoltoria bruta, quadros, pixels, landmarks
-- por frame. Guardar a envoltoria seria guardar uma representacao da voz; guardar
-- quadros seria guardar a imagem. Nada disso e necessario para dizer "houve mais
-- pausas neste minuto", que e a afirmacao que a Era precisa poder fazer.
--
-- **Offset relativo, nunca relogio de parede.** A janela diz "entre 4 e 5 minutos
-- de sessao", nunca "as 21h47". O horario nao acrescenta leitura e acrescenta
-- identificacao: cruzado com outras fontes, localiza a pessoa no tempo.
--
-- **Retencao de 7 dias, alinhada a midia bruta.** Detalhe temporal e dado
-- intermediario sensivel - "aos 14 minutos houve uma pausa longa" e
-- qualitativamente mais intimo que qualquer agregado. O agregado da sessao segue
-- as regras que ja tinha; o detalhe expira.

-- ---------------------------------------------------------------------------
-- 1. Janelas de sinal
-- ---------------------------------------------------------------------------

create table if not exists public.session_signal_windows (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.multimodal_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  -- Mesmo vocabulario FECHADO de `derived_features`. Emocao, sentimento e
  -- diagnostico nao tem nome nesta lista e nao podem ser inseridos.
  -- `speech_rate` fica de fora: ele depende da contagem de palavras, e a Web
  -- Speech API nao entrega palavra por instante. Reparti-las por tempo seria
  -- inventar a precisao que esta Era existe para nao inventar.
  signal_name text not null check (signal_name in (
    'pause_count',
    'pause_total_duration',
    'pause_mean_duration',
    'vocal_variation',
    'movement_frequency'
  )),
  start_offset_ms integer not null check (start_offset_ms between 0 and 3600000),
  end_offset_ms integer not null check (end_offset_ms between 0 and 3600000),
  value double precision not null check (value >= 0),
  extractor_version text not null default 'elyra-signals/v2'
    check (extractor_version in ('elyra-signals/v1', 'elyra-signals/v2')),
  -- Detalhe temporal expira junto com a midia bruta.
  retention_until timestamptz not null
    default (timezone('utc', now()) + interval '7 days'),
  created_at timestamptz not null default timezone('utc', now()),

  constraint session_signal_window_ordered check (end_offset_ms > start_offset_ms),
  constraint session_signal_window_unique
    unique (session_id, signal_name, start_offset_ms)
);

comment on table public.session_signal_windows is
  'Janelas derivadas de sinal, em offset relativo ao inicio da sessao. Expira em 7 dias.';

create index if not exists session_signal_windows_owner_idx
  on public.session_signal_windows (user_id, created_at desc);
create index if not exists session_signal_windows_session_idx
  on public.session_signal_windows (session_id, signal_name, start_offset_ms);
create index if not exists session_signal_windows_retention_idx
  on public.session_signal_windows (retention_until);

alter table public.session_signal_windows enable row level security;
alter table public.session_signal_windows force row level security;

create policy session_signal_windows_select_own
on public.session_signal_windows for select to authenticated
using ((select auth.uid()) = user_id);

create policy session_signal_windows_insert_own
on public.session_signal_windows for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.multimodal_sessions session
    where session.id = session_signal_windows.session_id
      and session.user_id = session_signal_windows.user_id
      -- Janela e detalhe do sinal: sem consentimento de analise nao existe sinal,
      -- e portanto nao pode existir janela.
      and session.ai_analysis_consent
  )
);

create policy session_signal_windows_delete_own
on public.session_signal_windows for delete to authenticated
using ((select auth.uid()) = user_id);

-- Leitura profissional acompanha o resultado deterministico.
create policy session_signal_windows_select_professional
on public.session_signal_windows for select to authenticated
using (
  exists (
    select 1 from public.multimodal_sessions session
    where session.id = session_signal_windows.session_id
      and session.user_id = session_signal_windows.user_id
      and session.share_result_consent
      and public.professional_access_allowed(
        session_signal_windows.user_id, 'multimodal_result'
      )
  )
);

grant select, insert, delete on table public.session_signal_windows to authenticated;
grant all on table public.session_signal_windows to service_role;

-- ---------------------------------------------------------------------------
-- 2. Segmentos de transcricao
--
-- `end_offset_ms` e o instante em que o **reconhecedor finalizou** o trecho, e
-- nao o instante da fala: a Web Speech API nao entrega o segundo, e o primeiro
-- atrasa em relacao a ele por um intervalo variavel que a API nao informa.
-- O nome da coluna diz isso, para que ninguem leia alinhamento por palavra onde
-- ha aproximacao por segmento.
-- ---------------------------------------------------------------------------

create table if not exists public.session_transcript_segments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.multimodal_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  segment_index integer not null check (segment_index >= 0),
  content text not null check (char_length(content) between 1 and 2000),
  start_offset_ms integer not null check (start_offset_ms between 0 and 3600000),
  recognized_at_offset_ms integer not null
    check (recognized_at_offset_ms between 0 and 3600000),
  -- A sessao e solo. `user` e a unica afirmacao honesta enquanto nao houver um
  -- segundo participante - e, quando houver, diarization sera problema novo,
  -- com consentimento de quem nao e titular.
  speaker text not null default 'user' check (speaker in ('user')),
  extractor_version text not null default 'elyra-signals/v2'
    check (extractor_version in ('elyra-signals/v1', 'elyra-signals/v2')),
  retention_until timestamptz not null
    default (timezone('utc', now()) + interval '7 days'),
  created_at timestamptz not null default timezone('utc', now()),

  constraint session_transcript_segment_ordered
    check (recognized_at_offset_ms >= start_offset_ms),
  constraint session_transcript_segment_unique unique (session_id, segment_index)
);

comment on table public.session_transcript_segments is
  'Trechos reconhecidos com o instante de RECONHECIMENTO, nao de fala. Expira em 7 dias.';
comment on column public.session_transcript_segments.recognized_at_offset_ms is
  'Quando o reconhecedor finalizou o trecho. Atrasa em relacao a fala por intervalo variavel.';

create index if not exists session_transcript_segments_owner_idx
  on public.session_transcript_segments (user_id, created_at desc);
create index if not exists session_transcript_segments_session_idx
  on public.session_transcript_segments (session_id, segment_index);
create index if not exists session_transcript_segments_retention_idx
  on public.session_transcript_segments (retention_until);

alter table public.session_transcript_segments enable row level security;
alter table public.session_transcript_segments force row level security;

create policy session_transcript_segments_select_own
on public.session_transcript_segments for select to authenticated
using ((select auth.uid()) = user_id);

create policy session_transcript_segments_insert_own
on public.session_transcript_segments for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.multimodal_sessions session
    where session.id = session_transcript_segments.session_id
      and session.user_id = session_transcript_segments.user_id
      and session.transcription_consent
      and session.microphone_consent
  )
);

create policy session_transcript_segments_delete_own
on public.session_transcript_segments for delete to authenticated
using ((select auth.uid()) = user_id);

-- Segmento **e** transcricao, e por isso segue o escopo da transcricao - nunca
-- o do resultado. Um relatorio que embutisse trecho sob `multimodal_result`
-- faria o escopo de resultado vazar conteudo de transcricao.
create policy session_transcript_segments_select_professional
on public.session_transcript_segments for select to authenticated
using (
  exists (
    select 1 from public.multimodal_sessions session
    where session.id = session_transcript_segments.session_id
      and session.user_id = session_transcript_segments.user_id
      and session.share_transcript_consent
      and public.professional_access_allowed(
        session_transcript_segments.user_id, 'multimodal_transcript'
      )
  )
);

grant select, insert, delete on table public.session_transcript_segments to authenticated;
grant all on table public.session_transcript_segments to service_role;

-- ---------------------------------------------------------------------------
-- 3. Auditoria de escrita
-- ---------------------------------------------------------------------------

create or replace function public.audit_era4_temporal_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  row_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
begin
  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    auth.uid(),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    row_id,
    'success',
    gen_random_uuid()
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger session_signal_windows_audit
after insert or delete on public.session_signal_windows
for each row execute function public.audit_era4_temporal_write();

create trigger session_transcript_segments_audit
after insert or delete on public.session_transcript_segments
for each row execute function public.audit_era4_temporal_write();
