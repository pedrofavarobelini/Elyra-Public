-- Era 4 / 22D - o escopo da IA se separa do escopo do calculo, e a janela da
-- Era 3 finalmente alcanca o multimodal.
--
-- **Dois defeitos de autorizacao que a auditoria encontrou.**
--
-- 1. `session_interpretations` (saida do modelo) e `derived_features` (calculo
--    deterministico) compartilhavam o **mesmo portao**: `share_result_consent` +
--    `multimodal_result`. A fronteira `DETERMINISTIC` / `AI`, que o produto
--    separa visualmente em toda tela, nao era autorizavel separadamente.
--    Conceder o numero concedia a leitura de modelo junto.
--
-- 2. A janela de dados da Era 3 cobre check-in, sono, meta, diario, ciclo e
--    snapshot - e **nao** cobre nada de multimodal. Conceder `multimodal_result`
--    concedia o historico multimodal inteiro, mesmo com `data_from`/`data_to`
--    declarados na permissao.
--
-- **Aditiva.** O escopo novo e acrescentado ao vocabulario; as policies sao
-- substituidas pelas equivalentes com recorte, sem drop que nao seja
-- imediatamente recriado. Nenhuma linha e apagada.

-- ---------------------------------------------------------------------------
-- 1. Vocabulario de escopo ganha a interpretacao de IA
-- ---------------------------------------------------------------------------

alter table public.sharing_permissions
  drop constraint if exists sharing_permissions_scope_check;
alter table public.sharing_permissions
  add constraint sharing_permissions_scope_check
  check (scope in (
    'emotional', 'sleep', 'goals', 'journal_entry', 'cycle', 'reports',
    'multimodal_result', 'multimodal_transcript', 'multimodal_media',
    'multimodal_ai_interpretation'
  ));

alter table public.professional_access_log
  drop constraint if exists professional_access_log_scope_check;
alter table public.professional_access_log
  add constraint professional_access_log_scope_check
  check (scope in (
    'emotional', 'sleep', 'goals', 'journal_entry', 'cycle', 'reports',
    'multimodal_result', 'multimodal_transcript', 'multimodal_media',
    'multimodal_ai_interpretation'
  ));

-- ---------------------------------------------------------------------------
-- 2. Janela de tempo para os registros datados do multimodal
--
-- A sessao e o registro datado; tudo o que pende dela herda a data dela. Um
-- sinal nao tem data propria - ele descreve uma sessao que tem.
-- ---------------------------------------------------------------------------

create or replace function public.professional_session_allowed_on(
  p_client_user_id uuid,
  p_scope text,
  p_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
    from public.multimodal_sessions session
    where session.id = p_session_id
      and session.user_id = p_client_user_id
      and public.professional_access_allowed_on(
        p_client_user_id,
        p_scope,
        -- A data civil da sessao, nos dois extremos: uma sessao acontece num dia.
        (session.started_at at time zone 'utc')::date,
        (session.started_at at time zone 'utc')::date
      )
  ), false);
$$;

revoke all on function public.professional_session_allowed_on(uuid, text, uuid) from public;
grant execute on function public.professional_session_allowed_on(uuid, text, uuid)
  to authenticated, service_role;

comment on function public.professional_session_allowed_on is
  'Autorizacao profissional para uma sessao, com o recorte de janela da Era 3.';

-- ---------------------------------------------------------------------------
-- 3. Policies profissionais com recorte
-- ---------------------------------------------------------------------------

drop policy if exists multimodal_sessions_select_professional on public.multimodal_sessions;
create policy multimodal_sessions_select_professional
on public.multimodal_sessions for select to authenticated
using (
  (share_result_consent and public.professional_access_allowed_on(
    user_id, 'multimodal_result',
    (started_at at time zone 'utc')::date, (started_at at time zone 'utc')::date))
  or (share_transcript_consent and public.professional_access_allowed_on(
    user_id, 'multimodal_transcript',
    (started_at at time zone 'utc')::date, (started_at at time zone 'utc')::date))
  or (share_original_consent and public.professional_access_allowed_on(
    user_id, 'multimodal_media',
    (started_at at time zone 'utc')::date, (started_at at time zone 'utc')::date))
);

drop policy if exists derived_features_select_professional on public.derived_features;
create policy derived_features_select_professional
on public.derived_features for select to authenticated
using (
  exists (
    select 1 from public.multimodal_sessions session
    where session.id = derived_features.session_id
      and session.user_id = derived_features.user_id
      and session.share_result_consent
      and public.professional_session_allowed_on(
        derived_features.user_id, 'multimodal_result', derived_features.session_id
      )
  )
);

drop policy if exists session_transcripts_select_professional on public.session_transcripts;
create policy session_transcripts_select_professional
on public.session_transcripts for select to authenticated
using (
  status = 'available'
  and exists (
    select 1 from public.multimodal_sessions session
    where session.id = session_transcripts.session_id
      and session.user_id = session_transcripts.user_id
      and session.share_transcript_consent
      and public.professional_session_allowed_on(
        session_transcripts.user_id, 'multimodal_transcript',
        session_transcripts.session_id
      )
  )
);

drop policy if exists session_transcript_segments_select_professional
  on public.session_transcript_segments;
create policy session_transcript_segments_select_professional
on public.session_transcript_segments for select to authenticated
using (
  exists (
    select 1 from public.multimodal_sessions session
    where session.id = session_transcript_segments.session_id
      and session.user_id = session_transcript_segments.user_id
      and session.share_transcript_consent
      and public.professional_session_allowed_on(
        session_transcript_segments.user_id, 'multimodal_transcript',
        session_transcript_segments.session_id
      )
  )
);

drop policy if exists session_signal_windows_select_professional
  on public.session_signal_windows;
create policy session_signal_windows_select_professional
on public.session_signal_windows for select to authenticated
using (
  exists (
    select 1 from public.multimodal_sessions session
    where session.id = session_signal_windows.session_id
      and session.user_id = session_signal_windows.user_id
      and session.share_result_consent
      and public.professional_session_allowed_on(
        session_signal_windows.user_id, 'multimodal_result',
        session_signal_windows.session_id
      )
  )
);

drop policy if exists session_modality_coverage_select_professional
  on public.session_modality_coverage;
create policy session_modality_coverage_select_professional
on public.session_modality_coverage for select to authenticated
using (
  exists (
    select 1 from public.multimodal_sessions session
    where session.id = session_modality_coverage.session_id
      and session.user_id = session_modality_coverage.user_id
      and session.share_result_consent
      and public.professional_session_allowed_on(
        session_modality_coverage.user_id, 'multimodal_result',
        session_modality_coverage.session_id
      )
  )
);

drop policy if exists session_self_reports_select_professional
  on public.session_self_reports;
create policy session_self_reports_select_professional
on public.session_self_reports for select to authenticated
using (
  exists (
    select 1 from public.multimodal_sessions session
    where session.id = session_self_reports.session_id
      and session.user_id = session_self_reports.user_id
      and session.share_result_consent
      and public.professional_session_allowed_on(
        session_self_reports.user_id, 'multimodal_result',
        session_self_reports.session_id
      )
  )
);

-- **A separacao que faltava.** A interpretacao passa a exigir escopo proprio.
-- Conceder o calculo deterministico deixa de conceder a leitura de modelo.
drop policy if exists session_interpretations_select_professional
  on public.session_interpretations;
create policy session_interpretations_select_professional
on public.session_interpretations for select to authenticated
using (
  exists (
    select 1 from public.multimodal_sessions session
    where session.id = session_interpretations.session_id
      and session.user_id = session_interpretations.user_id
      and session.share_result_consent
      and public.professional_session_allowed_on(
        session_interpretations.user_id, 'multimodal_ai_interpretation',
        session_interpretations.session_id
      )
  )
);

-- Midia bruta tambem passa a respeitar a janela.
drop policy if exists media_assets_select_professional on public.media_assets;
create policy media_assets_select_professional
on public.media_assets for select to authenticated
using (
  exists (
    select 1 from public.multimodal_sessions session
    where session.id = media_assets.session_id
      and session.user_id = media_assets.user_id
      and session.share_original_consent
      and public.professional_session_allowed_on(
        media_assets.user_id, 'multimodal_media', media_assets.session_id
      )
  )
);

drop policy if exists private_bucket_read_shared_multimodal on storage.objects;
create policy private_bucket_read_shared_multimodal
on storage.objects for select to authenticated
using (
  bucket_id = 'elyra-private'
  and exists (
    select 1
    from public.media_assets asset
    join public.multimodal_sessions session on session.id = asset.session_id
    where asset.storage_path = storage.objects.name
      and asset.status = 'stored'
      and session.share_original_consent
      and public.professional_session_allowed_on(
        asset.user_id, 'multimodal_media', asset.session_id
      )
  )
);
