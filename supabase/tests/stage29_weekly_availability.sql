-- Stage 29 / PRO-6 - agenda, provada por comportamento.
--
-- Atores: X e Y profissionais verificados, Z pendente; A e D com vinculo ativo
-- com X; B com vinculo ativo com Y; C com vinculo PAUSADO com X; A tambem com
-- vinculo ativo com Z (nao verificado). Disponibilidade de X: todos os dias,
-- 00:00-24:00, horarios de 60 min, America/Sao_Paulo.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

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
  ('29350000-0000-4000-8000-000000000001'::uuid, 'weekly-a@elyra.invalid', 'Titular A'),
  ('29350000-0000-4000-8000-000000000002'::uuid, 'weekly-b@elyra.invalid', 'Titular B'),
  ('29350000-0000-4000-8000-000000000003'::uuid, 'weekly-c@elyra.invalid', 'Titular C'),
  ('29350000-0000-4000-8000-000000000004'::uuid, 'weekly-d@elyra.invalid', 'Titular D'),
  ('29350000-0000-4000-8000-000000000011'::uuid, 'weekly-x@elyra.invalid', 'Profissional X'),
  ('29350000-0000-4000-8000-000000000012'::uuid, 'weekly-y@elyra.invalid', 'Profissional Y'),
  ('29350000-0000-4000-8000-000000000013'::uuid, 'weekly-z@elyra.invalid', 'Profissional Z')
) as fixture(id, email, name);

insert into public.professional_profiles (
  user_id, council_region, registration_number, specialty, verification_status,
  verification_reviewed_at, verification_review_due_at
) values
  ('29350000-0000-4000-8000-000000000011', '06', '06/600011', 'Psicologia', 'verified',
   timezone('utc', now()), timezone('utc', now()) + interval '365 days'),
  ('29350000-0000-4000-8000-000000000012', '06', '06/600012', 'Psicologia', 'verified',
   timezone('utc', now()), timezone('utc', now()) + interval '365 days'),
  ('29350000-0000-4000-8000-000000000013', '06', '06/600013', 'Psicologia', 'pending', null, null);

insert into public.professional_connections (
  id, client_user_id, professional_user_id, invited_by_user_id, status, accepted_at, paused_at
) values
  ('29350000-0000-4000-8000-0000000000c1', '29350000-0000-4000-8000-000000000001',
   '29350000-0000-4000-8000-000000000011', '29350000-0000-4000-8000-000000000011', 'active', now(), null),
  ('29350000-0000-4000-8000-0000000000c2', '29350000-0000-4000-8000-000000000002',
   '29350000-0000-4000-8000-000000000012', '29350000-0000-4000-8000-000000000012', 'active', now(), null),
  ('29350000-0000-4000-8000-0000000000c3', '29350000-0000-4000-8000-000000000003',
   '29350000-0000-4000-8000-000000000011', '29350000-0000-4000-8000-000000000011', 'paused', now(), now()),
  ('29350000-0000-4000-8000-0000000000c4', '29350000-0000-4000-8000-000000000004',
   '29350000-0000-4000-8000-000000000011', '29350000-0000-4000-8000-000000000011', 'active', now(), null),
  ('29350000-0000-4000-8000-0000000000c5', '29350000-0000-4000-8000-000000000001',
   '29350000-0000-4000-8000-000000000013', '29350000-0000-4000-8000-000000000013', 'active', now(), null),
  ('29350000-0000-4000-8000-0000000000c6', '29350000-0000-4000-8000-000000000001',
   '29350000-0000-4000-8000-000000000012', '29350000-0000-4000-8000-000000000012', 'active', now(), null);

-- Horario-alvo: hora cheia daqui a 3 h (hora cheia UTC = hora cheia em Sao Paulo).
create temporary table t (name text primary key, ts timestamptz, id uuid) on commit drop;
insert into t (name, ts) values
  ('s1', date_trunc('hour', now()) + interval '3 hours'),
  ('s2', date_trunc('hour', now()) + interval '5 hours');
grant all on t to authenticated;

create function pg_temp.as_user(p_id text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end;
$$;


-- Finite weekly publication (ADR-0035), all synthetic rows rolled back.
create temporary table ctx(w date, intervals jsonb, snapshot jsonb, appointment uuid, stale_revision text) on commit drop;
insert into ctx(w) values (date_trunc('week', now() at time zone 'America/Sao_Paulo')::date+7);
update ctx set intervals=jsonb_build_array(
 jsonb_build_object('date',w,'start_minute',540,'end_minute',720,'slot_minutes',30,'modality','online'),
 jsonb_build_object('date',w,'start_minute',840,'end_minute',1020,'slot_minutes',30,'modality','in_person'),
 jsonb_build_object('date',w+2,'start_minute',600,'end_minute',960,'slot_minutes',30,'modality','online'));
grant all on ctx to authenticated;
create function pg_temp.publish(p_w date,p_intervals jsonb,p_blocks jsonb default '[]') returns jsonb language sql as $$
 select public.save_professional_week_availability(p_w,'America/Sao_Paulo',p_intervals,p_blocks,
 public.get_professional_availability_week(p_w,'America/Sao_Paulo')->>'revision');
$$;
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.professional_availability_weeks'::regclass),'week metadata forced RLS');
select ok(not has_table_privilege('authenticated','public.professional_availability_weeks','UPDATE'),'no direct week writes');
select ok(not has_function_privilege('anon','public.save_professional_week_availability(date,text,jsonb,jsonb,text)','EXECUTE'),'anon cannot publish');
select ok(not has_function_privilege('service_role','public.save_professional_week_availability(date,text,jsonb,jsonb,text)','EXECUTE'),'RPC requires participant identity');
select pg_temp.as_user('29350000-0000-4000-8000-000000000011');
select is((public.get_professional_availability_week((select w from ctx),'America/Sao_Paulo')->>'published')::boolean,false,'week initially unpublished');
select lives_ok($$ update ctx set snapshot=pg_temp.publish(w,intervals) $$,'professional publishes week atomically');
select is(jsonb_array_length((select snapshot->'intervals' from ctx)),3,'multiple intervals in exact dates');
select is(jsonb_array_length((select snapshot->'slots' from ctx)),24,'saved snapshot immediately sees all 24 free slots');
select is((public.get_professional_availability_week((select w+7 from ctx),'America/Sao_Paulo')->>'published')::boolean,false,'adjacent week not published');
select is(jsonb_array_length(public.get_professional_availability_week((select w+7 from ctx),'America/Sao_Paulo')->'slots'),0,'nothing leaks outside published dates');
select is((public.get_professional_availability_week((select w from ctx),'America/Sao_Paulo')->>'timezone'),'America/Sao_Paulo','IANA timezone retained');
select is(pg_temp.publish((select w from ctx),(select intervals from ctx)),(select snapshot from ctx),'semantic replay idempotent');
select throws_ok($$ select pg_temp.publish(w,intervals || jsonb_build_array(jsonb_build_object('date',w,'start_minute',600,'end_minute',780,'slot_minutes',30,'modality','online'))) from ctx $$,'22023','overlapping_rules','overlap rejects whole transaction');
select is(public.get_professional_availability_week((select w from ctx),'America/Sao_Paulo'),(select snapshot from ctx),'failed save preserves complete prior week');
select throws_ok($$ select pg_temp.publish(w,jsonb_build_array(jsonb_build_object('date',w+7,'start_minute',540,'end_minute',720,'slot_minutes',30,'modality','online'))) from ctx $$,'22023','invalid_week','out-of-week rejected');
select throws_ok($$ select public.save_professional_week_availability(w,'Etc/GMT+3',intervals,'[]',snapshot->>'revision') from ctx $$,'22023','invalid_timezone','fixed offsets rejected');
select throws_ok($$ select pg_temp.publish(w+70,'[]') from ctx $$,'22023','invalid_week','beyond 60 days rejected');
select throws_ok($$ select pg_temp.publish(w-21,'[]') from ctx $$,'22023','invalid_week','past week rejected');
select is(jsonb_array_length(public.get_professional_availability_week((select w from ctx),'America/Sao_Paulo')->'slots'),24,'recurring templates cannot duplicate finite offers');
select public.save_professional_availability('America/Sao_Paulo','[{"weekday":1,"start_minute":540,"end_minute":720,"slot_minutes":30,"modality":"online"}]');
select is(jsonb_array_length(public.get_professional_availability_week((select w from ctx),'America/Sao_Paulo')->'slots'),24,'legacy rule overlapping finite dates remains inactive');
select is(jsonb_array_length(public.get_professional_availability_week((select w+7 from ctx),'America/Sao_Paulo')->'slots'),0,'legacy recurrence never opens adjacent week');
select pg_temp.as_user('29350000-0000-4000-8000-000000000012');
select is((select count(*)::int from public.professional_availability_weeks),0,'professional B cannot read A publication');
select lives_ok($$ select pg_temp.publish(w,'[]') from ctx $$,'B publishes only own week');
select pg_temp.as_user('29350000-0000-4000-8000-000000000011');
select is(jsonb_array_length(public.get_professional_availability_week((select w from ctx),'America/Sao_Paulo')->'intervals'),3,'B save did not change A');
select pg_temp.as_user('29350000-0000-4000-8000-000000000001');
select throws_ok($$ select pg_temp.publish(w,'[]') from ctx $$,'42501','verification_required','personal user cannot publish');
select is(jsonb_array_length(public.list_professional_week_slots('29350000-0000-4000-8000-000000000011',(select w from ctx))->'slots'),24,'active person sees published week only');
update ctx set appointment=public.request_appointment('29350000-0000-4000-8000-0000000000c1',((w+time '09:00') at time zone 'America/Sao_Paulo'),'online',gen_random_uuid());
select is(jsonb_array_length(public.list_professional_week_slots('29350000-0000-4000-8000-000000000011',(select w from ctx))->'slots'),23,'requested slot is occupied');
select pg_temp.as_user('29350000-0000-4000-8000-000000000011');
select public.confirm_appointment((select appointment from ctx));
select pg_temp.publish((select w from ctx),(select jsonb_agg(jsonb_set(item,'{slot_minutes}','60')) from ctx,jsonb_array_elements(intervals) item));
select is(jsonb_array_length(public.get_professional_availability_week((select w from ctx),'America/Sao_Paulo')->'conflicts'),1,
 'changing slot duration warns about the existing confirmed appointment');
select is((select status from public.appointments where id=(select appointment from ctx)),'confirmed','duration edit preserves confirmation');
select pg_temp.publish((select w from ctx),(select intervals from ctx));
update ctx set snapshot=pg_temp.publish(w,intervals,jsonb_build_array(jsonb_build_object('date',w,'start_minute',null,'end_minute',null)));
select is((select status from public.appointments where id=(select appointment from ctx)),'confirmed','blocking does not cancel confirmed appointment');
select is(jsonb_array_length((select snapshot->'conflicts' from ctx)),1,'confirmed conflict explicitly listed');
select is(jsonb_array_length((select snapshot->'slots' from ctx)),12,'full day block removes free offers only');
update ctx set snapshot=pg_temp.publish(w,'[]');
select is(jsonb_array_length((select snapshot->'intervals' from ctx)),0,'removing availability updates future offer');
select is((select status from public.appointments where id=(select appointment from ctx)),'confirmed','removal preserves confirmed appointment');
select is(jsonb_array_length((select snapshot->'conflicts' from ctx)),1,'removal also returns explicit conflict');
select is((select snapshot->>'published' from ctx),'true','published empty week retains publication state');
select public.cancel_appointment((select appointment from ctx),'schedule_change');
select is((select status from public.appointments where id=(select appointment from ctx)),'cancelled','separate explicit cancellation changes appointment');
-- Editing, stale revisions, ranged blocks and adjacent publication.
update ctx set stale_revision=snapshot->>'revision';
select lives_ok($$ select pg_temp.publish(w+7,jsonb_build_array(jsonb_build_object('date',w+7,'start_minute',540,'end_minute',600,'slot_minutes',30,'modality','online'))) from ctx $$,'publish an adjacent finite week');
update ctx set snapshot=pg_temp.publish(w,intervals,jsonb_build_array(jsonb_build_object('date',w+2,'start_minute',600,'end_minute',660)));
select is(jsonb_array_length((select snapshot->'slots' from ctx)),22,'range block removes exactly two Wednesday slots');
select throws_ok($$ select public.save_professional_week_availability(w,'America/Sao_Paulo','[]','[]',stale_revision) from ctx $$,'40001','week_changed','stale different content rejected');
select is(jsonb_array_length(public.get_professional_availability_week((select w+7 from ctx),'America/Sao_Paulo')->'slots'),2,'editing target leaves adjacent publication intact');
select lives_ok($$ select public.save_professional_week_availability(w,'America/Sao_Paulo',intervals,jsonb_build_array(jsonb_build_object('date',w+2,'start_minute',600,'end_minute',660)),stale_revision) from ctx $$,'exact semantic replay is safe even with old revision');
select throws_ok($$ select pg_temp.publish(w,intervals || '[{"date":"2026-02-30","start_minute":540,"end_minute":600,"slot_minutes":30,"modality":"online"}]') from ctx $$,'22023','invalid_week','impossible calendar date rejected');
select throws_ok($$ select pg_temp.publish(w,jsonb_build_array(jsonb_build_object('date',w,'start_minute',540,'end_minute',600,'slot_minutes',15,'modality','online'))) from ctx $$,'22023','invalid_week','unsupported duration rejected');
select ok(not public.scheduling_window_ok(now()+interval '59 minutes'),'60 minute lead preserved');
select ok(public.scheduling_window_ok(now()+interval '61 minutes'),'beyond lead allowed');
select ok(not public.scheduling_window_ok(now()+interval '60 days 1 minute'),'60 day horizon preserved');

-- Finite legacy ranges spanning the target are split, not lost.
reset role;
insert into public.professional_availability_exceptions(professional_user_id,kind,starts_on,ends_on,start_minute,end_minute,slot_minutes,timezone,modality)
select '29350000-0000-4000-8000-000000000012','open',w-1,w+7,540,600,30,'America/Sao_Paulo','online' from ctx;
select pg_temp.as_user('29350000-0000-4000-8000-000000000012');
select lives_ok($$ select pg_temp.publish(w,'[]') from ctx $$,'remove week from a crossing finite date range');
select is((select count(*)::int from public.professional_availability_exceptions),2,'two residual ranges survive');
select ok(exists(select 1 from public.professional_availability_exceptions where ends_on=(select w-1 from ctx)),'left residual preserved');
select ok(exists(select 1 from public.professional_availability_exceptions where starts_on=(select w+7 from ctx)),'right residual preserved');
select is(jsonb_array_length(public.get_professional_availability_week((select w from ctx),'America/Sao_Paulo')->'slots'),0,'removed target range offers no slots');

-- Past dates and DST are tested via historical synthetic dates, not clock mutation.
reset role;
insert into public.professional_availability_exceptions(professional_user_id,kind,starts_on,ends_on,start_minute,end_minute,slot_minutes,timezone,modality)
values ('29350000-0000-4000-8000-000000000012','open','2026-03-08','2026-03-08',60,240,60,'America/New_York','in_person'),
 ('29350000-0000-4000-8000-000000000012','open','2026-11-01','2026-11-01',60,240,60,'America/New_York','in_person');
select is((select count(*)::int from public.professional_slot_offer('29350000-0000-4000-8000-000000000012','2026-03-08 07:00Z','in_person')),1,'DST spring valid 03:00 is offered');
select is((select count(*)::int from public.professional_slot_offer('29350000-0000-4000-8000-000000000012','2026-11-01 05:00Z','in_person')),0,'DST fold first duplicate civil instant excluded');
select is((select count(*)::int from public.professional_slot_offer('29350000-0000-4000-8000-000000000012','2026-11-01 06:00Z','in_person')),1,'DST fold canonical instant offered exactly once');
select pg_temp.as_user('29350000-0000-4000-8000-000000000012');
select throws_ok($$ select public.save_professional_week_availability(w,'America/New_York','[]','[]',public.get_professional_availability_week(w,'America/New_York')->>'revision') from ctx $$,'22023','timezone_conflict','cannot reinterpret other future publications in a different timezone');

reset role;
select is((select count(*)::int from public.professional_availability_rules where professional_user_id='29350000-0000-4000-8000-000000000011'),1,'legacy template data preserved');
select is((select count(*)::int from public.audit_logs where actor_user_id='29350000-0000-4000-8000-000000000011' and action='scheduling.week_published'),7,'replays and rejected saves do not duplicate audit events');
-- Preserve legacy read-only days at the last editable week's horizon.
create temporary table horizon(w date, last_day date, blocks jsonb) on commit drop;
insert into horizon(w,last_day) select date_trunc('week',(now() at time zone 'America/Sao_Paulo')::date+60)::date,
 (now() at time zone 'America/Sao_Paulo')::date+60;
insert into public.professional_availability_exceptions(professional_user_id,kind,starts_on,ends_on,timezone)
select '29350000-0000-4000-8000-000000000011','block',w,w+6,'America/Sao_Paulo' from horizon;
grant all on horizon to authenticated;
select pg_temp.as_user('29350000-0000-4000-8000-000000000011');
update horizon set blocks=(select jsonb_agg(jsonb_build_object('date',d::date,'start_minute',null,'end_minute',null))
 from generate_series(w::timestamp,(w+6)::timestamp,interval '1 day') d);
select lives_ok($$ select pg_temp.publish(w,jsonb_build_array(jsonb_build_object('date',w,'start_minute',540,'end_minute',600,'slot_minutes',30,'modality','online')),blocks) from horizon $$,
 'last week publishes editable day while preserving read-only legacy days');
select is(jsonb_array_length(public.get_professional_availability_week((select w from horizon),'America/Sao_Paulo')->'blocks'),7,
 'legacy blocks remain intact on both sides of horizon');
select case when (select last_day<w+6 from horizon) then
 throws_ok($$ select pg_temp.publish(w,'[]',blocks || jsonb_build_array(jsonb_build_object('date',last_day+1,'start_minute',720,'end_minute',780))) from horizon $$,
 '22023','invalid_week','new out-of-horizon block rejected')
 else skip('no out-of-horizon day in this final week',1) end;
select case when extract(isodow from now() at time zone 'America/Sao_Paulo')>1 then
 throws_ok($$ select pg_temp.publish(date_trunc('week',now() at time zone 'America/Sao_Paulo')::date,
 jsonb_build_array(jsonb_build_object('date',(now() at time zone 'America/Sao_Paulo')::date-1,'start_minute',540,'end_minute',600,'slot_minutes',30,'modality','online'))) $$,
 '22023','past_availability_readonly','past dates in current week are not rewritten')
 else skip('Monday has no earlier date in the current week',1) end;
select * from finish();
rollback;
