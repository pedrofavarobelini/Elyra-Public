-- Stage 29 / PRO-3 - matriz RLS obrigatoria, contra o banco real.
--
-- Titulares A e B; profissionais X e Y verificados; Z nao verificado.
-- Toda medicao troca de papel de verdade: superusuario ignora RLS.
--
-- Regra sob teste: leitura profissional existe SOMENTE com relationship
-- `active` + verificacao vigente + grant `granted`/`read` + vigencia + escopo +
-- recurso + janela (+ consentimento da sessao no multimodal). Qualquer
-- ausencia: DENY. Qualquer vazamento aqui e HARD STOP.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(62);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
       email, null, timezone('utc', now()), '', '', '', '', '', '', '', '',
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', name),
       timezone('utc', now()), timezone('utc', now())
from (values
  ('29300000-0000-4000-8000-000000000001'::uuid, 'pro3-a@elyra.invalid', 'Titular A'),
  ('29300000-0000-4000-8000-000000000002'::uuid, 'pro3-b@elyra.invalid', 'Titular B'),
  ('29300000-0000-4000-8000-000000000011'::uuid, 'pro3-x@elyra.invalid', 'Profissional X'),
  ('29300000-0000-4000-8000-000000000012'::uuid, 'pro3-y@elyra.invalid', 'Profissional Y'),
  ('29300000-0000-4000-8000-000000000013'::uuid, 'pro3-z@elyra.invalid', 'Profissional Z')
) as fixture(id, email, name);

insert into public.professional_profiles (
  user_id, council_region, registration_number, specialty, verification_status,
  verification_reviewed_at, verification_review_due_at
) values
  ('29300000-0000-4000-8000-000000000011', '06', '06/300011', 'Psicologia', 'verified',
   timezone('utc', now()), timezone('utc', now()) + interval '365 days'),
  ('29300000-0000-4000-8000-000000000012', '06', '06/300012', 'Psicologia', 'verified',
   timezone('utc', now()), timezone('utc', now()) + interval '365 days'),
  ('29300000-0000-4000-8000-000000000013', '06', '06/300013', 'Psicologia', 'pending',
   null, null);

insert into public.emotional_checkins (id, user_id, occurred_at, mood_score) values
  ('29300000-0000-4000-8000-0000000000e1', '29300000-0000-4000-8000-000000000001', timezone('utc', now()), 6),
  ('29300000-0000-4000-8000-0000000000e2', '29300000-0000-4000-8000-000000000001', timezone('utc', now()) - interval '100 days', 4),
  ('29300000-0000-4000-8000-0000000000e3', '29300000-0000-4000-8000-000000000002', timezone('utc', now()), 8);

insert into public.journal_entries (id, user_id, title, content, status) values
  ('29300000-0000-4000-8000-0000000000a1', '29300000-0000-4000-8000-000000000001', 'J1', 'conteudo 1', 'saved'),
  ('29300000-0000-4000-8000-0000000000a2', '29300000-0000-4000-8000-000000000001', 'J2', 'conteudo 2', 'saved');

insert into public.multimodal_sessions (
  id, user_id, kind, status, microphone_consent, ai_analysis_consent,
  share_result_consent, started_at
) values
  ('29300000-0000-4000-8000-0000000000b1', '29300000-0000-4000-8000-000000000001',
   'guided', 'completed', true, true, false, timezone('utc', now()) - interval '1 day'),
  ('29300000-0000-4000-8000-0000000000b2', '29300000-0000-4000-8000-000000000001',
   'guided', 'completed', true, true, true, timezone('utc', now()) - interval '1 day');

insert into public.derived_features
  (session_id, user_id, signal_name, unit, value, status,
   personal_baseline_mean, personal_baseline_samples, delta_vs_personal_baseline)
values
  ('29300000-0000-4000-8000-0000000000b1', '29300000-0000-4000-8000-000000000001',
   'pause_count', 'count', 5, 'available', 4, 3, 1),
  ('29300000-0000-4000-8000-0000000000b2', '29300000-0000-4000-8000-000000000001',
   'pause_count', 'count', 6, 'available', 4, 3, 2);

insert into public.professional_connections (
  id, client_user_id, professional_user_id, invited_by_user_id, status, accepted_at
) values
  ('29300000-0000-4000-8000-0000000000c1', '29300000-0000-4000-8000-000000000001',
   '29300000-0000-4000-8000-000000000011', '29300000-0000-4000-8000-000000000011',
   'active', timezone('utc', now())),
  ('29300000-0000-4000-8000-0000000000c3', '29300000-0000-4000-8000-000000000001',
   '29300000-0000-4000-8000-000000000013', '29300000-0000-4000-8000-000000000013',
   'active', timezone('utc', now()));

insert into public.sharing_permissions (connection_id, scope, journal_entry_id) values
  ('29300000-0000-4000-8000-0000000000c3', 'emotional', null);

-- Mede quantas linhas o ator enxerga. `anon` e medido com o papel anon.
create function pg_temp.seen(p_actor uuid, p_what text)
returns integer
language plpgsql
as $$
declare n integer;
begin
  if p_actor is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;

  if p_what = 'A.emotional' then
    select count(*) into n from public.emotional_checkins where user_id = '29300000-0000-4000-8000-000000000001';
  elsif p_what = 'A.emotional.old' then
    select count(*) into n from public.emotional_checkins where id = '29300000-0000-4000-8000-0000000000e2';
  elsif p_what = 'B.emotional' then
    select count(*) into n from public.emotional_checkins where user_id = '29300000-0000-4000-8000-000000000002';
  elsif p_what = 'A.J1' then
    select count(*) into n from public.journal_entries where id = '29300000-0000-4000-8000-0000000000a1';
  elsif p_what = 'A.J2' then
    select count(*) into n from public.journal_entries where id = '29300000-0000-4000-8000-0000000000a2';
  elsif p_what = 'A.features' then
    select count(*) into n from public.derived_features where user_id = '29300000-0000-4000-8000-000000000001';
  elsif p_what = 'A.profile' then
    select count(*) into n from public.profiles where user_id = '29300000-0000-4000-8000-000000000001';
  elsif p_what = 'AX.connection' then
    select count(*) into n from public.professional_connections where id = '29300000-0000-4000-8000-0000000000c1';
  elsif p_what = 'AX.grants' then
    select count(*) into n from public.sharing_permissions where connection_id = '29300000-0000-4000-8000-0000000000c1';
  elsif p_what = 'AX.trail' then
    select count(*) into n from public.professional_access_log where connection_id = '29300000-0000-4000-8000-0000000000c1';
  else
    raise exception 'medicao nao mapeada: %', p_what;
  end if;

  reset role;
  return n;
end;
$$;

create function pg_temp.as_user(p_actor uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
$$;

-- Chamada de RPC como o ator, fora de throws_ok.
create function pg_temp.act(p_actor uuid, p_sql text)
returns void
language plpgsql
as $$
begin
  perform pg_temp.as_user(p_actor);
  set local role authenticated;
  execute p_sql;
  reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- Forma
-- ---------------------------------------------------------------------------

select is(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'professional_connections_status_check'),
  'CHECK ((status = ANY (ARRAY[''pending''::text, ''active''::text, ''paused''::text, ''revoked''::text, ''ended''::text])))',
  'relationship usa o vocabulario pending/active/paused/revoked/ended'
);
select is((select count(*)::integer from public.professional_connections where status = 'accepted'), 0,
  'nenhuma relationship ficou no vocabulario antigo');
select ok(exists (select 1 from information_schema.columns where table_name = 'sharing_permissions' and column_name = 'valid_from'), 'grant tem valid_from');
select ok(exists (select 1 from pg_constraint where conname = 'sharing_permissions_permission_check'), 'grant e somente leitura por constraint');
select ok(
  not has_function_privilege('authenticated', 'public.professional_trail_append(uuid,text,text,text)', 'EXECUTE'),
  'ninguem grava ciclo de vida direto na trilha'
);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public' and policyname like '%professional%' and cmd in ('UPDATE', 'DELETE', 'INSERT')
      and tablename in ('emotional_checkins', 'emotional_checkin_factors', 'sleep_records', 'goals',
        'goal_progress_entries', 'journal_entries', 'journal_entry_tags', 'cycle_profiles', 'cycle_periods',
        'cycle_daily_records', 'cycle_daily_symptoms', 'report_snapshots', 'multimodal_sessions',
        'derived_features', 'session_transcripts', 'session_transcript_segments', 'session_signal_windows',
        'session_modality_coverage', 'session_self_reports', 'session_interpretations', 'media_assets',
        'transcript_corrections')
  ),
  'nenhuma policy de escrita profissional em dado pessoal'
);

-- ---------------------------------------------------------------------------
-- Base: relationship ativa, verificado, sem grant
-- ---------------------------------------------------------------------------

select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.emotional'), 0, 'active sem grant -> DENIED');
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.profile'), 1, 'active + verificado ve o perfil basico');
select is(pg_temp.seen('29300000-0000-4000-8000-000000000012', 'A.emotional'), 0, 'sem relationship (Y) -> DENIED');
select is(pg_temp.seen('29300000-0000-4000-8000-000000000012', 'A.profile'), 0, 'sem relationship nao ve nem o nome');
select is(pg_temp.seen('29300000-0000-4000-8000-000000000013', 'A.emotional'), 0, 'nao verificado com relationship e grant (Z) -> DENIED');
select is(pg_temp.seen('29300000-0000-4000-8000-000000000013', 'A.profile'), 0, 'nao verificado nao ve nem o nome');
-- anon nem chega a RLS: nao tem privilegio de tabela.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$select count(*) from public.emotional_checkins$$, '42501', null, 'anon -> DENIED (sem privilegio)');
select throws_ok($$select count(*) from public.professional_connections$$, '42501', null, 'anon nao ve relationship');
reset role;

-- Grant incorreto (escopo diferente).
select pg_temp.act('29300000-0000-4000-8000-000000000001',
  $$select public.set_sharing_permission('29300000-0000-4000-8000-0000000000c1', 'sleep', true)$$);
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.emotional'), 0, 'grant de outro escopo -> DENIED');

-- Grant correto.
select pg_temp.act('29300000-0000-4000-8000-000000000001',
  $$select public.set_sharing_permission('29300000-0000-4000-8000-0000000000c1', 'emotional', true)$$);
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.emotional'), 2, 'ALLOWED: active + verificado + grant + escopo');
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'B.emotional'), 0, 'outro usuario (B) pelo mesmo profissional -> DENIED');
select is(pg_temp.seen('29300000-0000-4000-8000-000000000012', 'A.emotional'), 0, 'outro profissional (Y) com grant de X -> DENIED');
select is(pg_temp.seen('29300000-0000-4000-8000-000000000012', 'AX.connection'), 0, 'Y nao ve a relationship de X');
select is(pg_temp.seen('29300000-0000-4000-8000-000000000012', 'AX.grants'), 0, 'Y nao ve os grants de X');
select is(pg_temp.seen('29300000-0000-4000-8000-000000000002', 'AX.grants'), 0, 'B nao ve os grants de A');
select is(pg_temp.seen('29300000-0000-4000-8000-000000000002', 'A.emotional'), 0, 'B nao le A');

-- Janela de dados.
select pg_temp.act('29300000-0000-4000-8000-000000000001',
  $$select public.set_sharing_data_window('29300000-0000-4000-8000-0000000000c1', 'emotional', (current_date - 10), null)$$);
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.emotional'), 1, 'janela recorta: so o registro dentro dela');
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.emotional.old'), 0, 'fora de data_from -> DENIED');
select pg_temp.act('29300000-0000-4000-8000-000000000001',
  $$select public.set_sharing_data_window('29300000-0000-4000-8000-0000000000c1', 'emotional', null, (current_date - 200))$$);
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.emotional'), 0, 'fora de data_to -> DENIED');
select pg_temp.act('29300000-0000-4000-8000-000000000001',
  $$select public.set_sharing_data_window('29300000-0000-4000-8000-0000000000c1', 'emotional', null, null)$$);

-- Vigencia do grant.
select pg_temp.act('29300000-0000-4000-8000-000000000001',
  $$select public.set_sharing_grant_validity('29300000-0000-4000-8000-0000000000c1', 'emotional', statement_timestamp() + interval '1 day', null)$$);
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.emotional'), 0, 'valid_from no futuro -> DENIED');
select pg_temp.act('29300000-0000-4000-8000-000000000001',
  $$select public.set_sharing_grant_validity('29300000-0000-4000-8000-0000000000c1', 'emotional', null, null)$$);
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.emotional'), 2, 'vigencia removida volta a valer');
update public.sharing_permissions
set granted_at = timezone('utc', now()) - interval '3 days',
    expires_at = timezone('utc', now()) - interval '1 minute'
where connection_id = '29300000-0000-4000-8000-0000000000c1' and scope = 'emotional';
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.emotional'), 0, 'grant expirado -> DENIED');
select pg_temp.act('29300000-0000-4000-8000-000000000001',
  $$select public.set_sharing_permission('29300000-0000-4000-8000-0000000000c1', 'emotional', true)$$);
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.emotional'), 2, 'reconceder volta a valer');

-- Revogacao do grant: efeito na proxima consulta.
select pg_temp.act('29300000-0000-4000-8000-000000000001',
  $$select public.set_sharing_permission('29300000-0000-4000-8000-0000000000c1', 'emotional', false)$$);
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.emotional'), 0, 'grant revogado -> DENIED na consulta seguinte');
select pg_temp.act('29300000-0000-4000-8000-000000000001',
  $$select public.set_sharing_permission('29300000-0000-4000-8000-0000000000c1', 'emotional', true)$$);

-- Diario por entrada (resource_id).
select pg_temp.act('29300000-0000-4000-8000-000000000001',
  $$select public.set_sharing_permission('29300000-0000-4000-8000-0000000000c1', 'journal_entry', true, '29300000-0000-4000-8000-0000000000a1')$$);
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.J1'), 1, 'ALLOWED: entrada concedida');
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.J2'), 0, 'resource_id diferente -> DENIED');

-- Multimodal: grant sem consentimento da sessao nao abre.
select pg_temp.act('29300000-0000-4000-8000-000000000001',
  $$select public.set_sharing_permission('29300000-0000-4000-8000-0000000000c1', 'multimodal_result', true)$$);
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.features'), 1,
  'multimodal: so a sessao com consentimento especifico abre');

-- ---------------------------------------------------------------------------
-- Estados da relationship
-- ---------------------------------------------------------------------------

select pg_temp.act('29300000-0000-4000-8000-000000000001',
  $$select public.pause_professional_relationship('29300000-0000-4000-8000-0000000000c1')$$);
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.emotional'), 0, 'paused -> DENIED');
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.J1'), 0, 'paused fecha o diario');
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.profile'), 0, 'paused fecha o perfil basico');
select is(
  (select count(*)::integer from public.sharing_permissions
   where connection_id = '29300000-0000-4000-8000-0000000000c1' and status = 'granted'),
  4,
  'pausa preserva os grants'
);
select pg_temp.as_user('29300000-0000-4000-8000-000000000011');
set local role authenticated;
select throws_ok(
  $$insert into public.professional_notes (connection_id, professional_user_id, client_user_id, body)
    values ('29300000-0000-4000-8000-0000000000c1', '29300000-0000-4000-8000-000000000011',
            '29300000-0000-4000-8000-000000000001', 'nota')$$,
  '42501', null,
  'paused nao aceita nota nova'
);
select throws_ok(
  $$select public.resume_professional_relationship('29300000-0000-4000-8000-0000000000c1')$$,
  '42501', null,
  'profissional nao retoma pausa do titular'
);
reset role;
select pg_temp.as_user('29300000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.resume_professional_relationship('29300000-0000-4000-8000-0000000000c1')$$,
  '42501', null,
  'outro usuario nao mexe na relationship de A'
);
reset role;
select pg_temp.act('29300000-0000-4000-8000-000000000001',
  $$select public.resume_professional_relationship('29300000-0000-4000-8000-0000000000c1')$$);
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.emotional'), 2, 'retomada restaura o acesso concedido');

-- Pending (fixture direta: o estado so nasce pelo fluxo legado).
update public.professional_connections
set status = 'pending', accepted_at = null
where id = '29300000-0000-4000-8000-0000000000c1';
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.emotional'), 0, 'pending (com grant residual) -> DENIED');
update public.professional_connections
set status = 'active', accepted_at = timezone('utc', now())
where id = '29300000-0000-4000-8000-0000000000c1';

-- Verificacao que vence durante o vinculo.
update public.professional_profiles
set verification_reviewed_at = timezone('utc', now()) - interval '2 days',
    verification_review_due_at = timezone('utc', now()) - interval '1 second'
where user_id = '29300000-0000-4000-8000-000000000011';
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.emotional'), 0, 'verificacao vencida no meio do vinculo -> DENIED');
update public.professional_profiles
set verification_reviewed_at = timezone('utc', now()),
    verification_review_due_at = timezone('utc', now()) + interval '365 days'
where user_id = '29300000-0000-4000-8000-000000000011';

-- ---------------------------------------------------------------------------
-- Escrita profissional em dado pessoal
-- ---------------------------------------------------------------------------

select pg_temp.as_user('29300000-0000-4000-8000-000000000011');
set local role authenticated;
select throws_ok(
  $$insert into public.emotional_checkins (user_id, occurred_at, mood_score)
    values ('29300000-0000-4000-8000-000000000001', timezone('utc', now()), 1)$$,
  '42501', null,
  'profissional nao insere dado pessoal'
);
update public.emotional_checkins set mood_score = 1 where user_id = '29300000-0000-4000-8000-000000000001';
delete from public.journal_entries where id = '29300000-0000-4000-8000-0000000000a1';
select throws_ok(
  $$select public.set_sharing_permission('29300000-0000-4000-8000-0000000000c1', 'sleep', true)$$,
  '42501', null,
  'profissional nao concede grant a si mesmo'
);
select throws_ok(
  $$select public.set_sharing_data_window('29300000-0000-4000-8000-0000000000c1', 'emotional', null, null)$$,
  '42501', null,
  'profissional nao alarga a propria janela'
);
select throws_ok(
  $$select public.set_sharing_grant_validity('29300000-0000-4000-8000-0000000000c1', 'emotional', null, null)$$,
  '42501', null,
  'profissional nao estende a propria vigencia'
);
select throws_ok(
  $$select public.pause_professional_relationship('29300000-0000-4000-8000-0000000000c1')$$,
  '42501', null,
  'profissional nao pausa (so o titular)'
);
select throws_ok(
  $$insert into public.professional_access_log
      (connection_id, client_user_id, professional_user_id, scope, event_type)
    values ('29300000-0000-4000-8000-0000000000c1', '29300000-0000-4000-8000-000000000001',
            '29300000-0000-4000-8000-000000000011', 'emotional', 'grant_created')$$,
  '42501', null,
  'profissional nao forja evento de ciclo de vida na trilha'
);
select lives_ok(
  $$insert into public.professional_access_log
      (connection_id, client_user_id, professional_user_id, scope)
    values ('29300000-0000-4000-8000-0000000000c1', '29300000-0000-4000-8000-000000000001',
            '29300000-0000-4000-8000-000000000011', 'emotional')$$,
  'profissional registra a propria leitura'
);
reset role;
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'AX.trail'), 0, 'profissional nao le a trilha do titular');

select is(
  (select mood_score::integer from public.emotional_checkins where id = '29300000-0000-4000-8000-0000000000e1'),
  6,
  'update profissional nao alterou nada'
);
select is(
  (select count(*)::integer from public.journal_entries where id = '29300000-0000-4000-8000-0000000000a1'),
  1,
  'delete profissional nao apagou nada'
);

-- ---------------------------------------------------------------------------
-- Encerramento e trilha
-- ---------------------------------------------------------------------------

select pg_temp.act('29300000-0000-4000-8000-000000000011',
  $$select public.revoke_professional_connection('29300000-0000-4000-8000-0000000000c1')$$);
select is(
  (select status || ':' || (ended_by_user_id = professional_user_id)::text
   from public.professional_connections where id = '29300000-0000-4000-8000-0000000000c1'),
  'ended:true',
  'profissional encerra -> ended'
);
select is(pg_temp.seen('29300000-0000-4000-8000-000000000011', 'A.emotional'), 0, 'ended -> DENIED');
select is(
  (select count(*)::integer from public.sharing_permissions
   where connection_id = '29300000-0000-4000-8000-0000000000c1' and status = 'granted'),
  0,
  'encerramento revoga todos os grants'
);
select ok(
  pg_temp.seen('29300000-0000-4000-8000-000000000001', 'AX.trail') >= 10,
  'titular ve a trilha completa do vinculo'
);
select is(
  (select string_agg(distinct event_type, ',' order by event_type)
   from public.professional_access_log where connection_id = '29300000-0000-4000-8000-0000000000c1'),
  'grant_changed,grant_created,grant_revoked,relationship_ended,relationship_paused,relationship_resumed,resource_viewed',
  'trilha registra grant, pausa, retomada, leitura e encerramento'
);
select is(
  (select actor_role from public.professional_access_log
   where connection_id = '29300000-0000-4000-8000-0000000000c1' and event_type = 'relationship_ended'),
  'professional',
  'titular sabe que foi o profissional quem encerrou'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_name = 'professional_access_log'
      and column_name in ('content', 'body', 'payload', 'text', 'transcript', 'note', 'value')
  ),
  'trilha nao tem coluna de conteudo'
);

-- Revogado pelo titular (via Z, que continua negado por verificacao).
select pg_temp.act('29300000-0000-4000-8000-000000000001',
  $$select public.revoke_professional_connection('29300000-0000-4000-8000-0000000000c3')$$);
select is(
  (select status from public.professional_connections where id = '29300000-0000-4000-8000-0000000000c3'),
  'revoked',
  'titular encerra -> revoked'
);
select is(pg_temp.seen('29300000-0000-4000-8000-000000000013', 'A.emotional'), 0, 'revoked -> DENIED');

select * from finish();
rollback;
