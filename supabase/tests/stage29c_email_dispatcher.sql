-- Stage 29-C - dispatcher de e-mail, provado como `service_role` REAL.
--
-- Diferenca deliberada em relacao a `stage23a_email_deliveries.sql`: aqui as
-- RPCs sao chamadas com `role = service_role` e **sem** `sub` nas claims — como
-- o cliente do dispatcher as chama pelo PostgREST. Foi exatamente essa forma
-- que o teste antigo nao exercitava, e por isso L-278 passou despercebido.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(49);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '96290000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'stage29c-a@elyra.invalid', null,
   timezone('utc', now()), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Pessoa A"}'::jsonb,
   timezone('utc', now()), timezone('utc', now())),
  -- B nunca confirmou o endereco: nao pode receber e-mail de engajamento.
  ('00000000-0000-0000-0000-000000000000', '96290000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'stage29c-b@elyra.invalid', null,
   null, '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Pessoa B"}'::jsonb,
   timezone('utc', now()), timezone('utc', now()));

select public.seed_notification_preferences('96290000-0000-4000-8000-000000000001');
select public.seed_notification_preferences('96290000-0000-4000-8000-000000000002');

-- ---------------------------------------------------------------------------
-- 1. Privilegios: so service_role executa; a sessao so le a saude
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.due_notification_emails(text, integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.due_notification_emails(text, integer)', 'EXECUTE'),
  'due_notification_emails recusa authenticated e anon'
);
select ok(
  not has_function_privilege('authenticated', 'public.enqueue_notification_email_for(uuid, text, text, text, text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.enqueue_notification_email_for(uuid, text, text, text, text, text)', 'EXECUTE'),
  'enqueue_notification_email_for recusa authenticated e anon'
);
select ok(
  not has_function_privilege('authenticated', 'public.settle_notification_email_for(uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.settle_notification_email_for(uuid, text, text)', 'EXECUTE'),
  'settle_notification_email_for recusa authenticated e anon'
);
select ok(
  not has_function_privilege('authenticated', 'public.purge_email_delivery_history()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.email_deliveries_used_since(timestamptz)', 'EXECUTE'),
  'retencao e cota nao sao da sessao'
);
select ok(
  has_function_privilege('service_role', 'public.due_notification_emails(text, integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.enqueue_notification_email_for(uuid, text, text, text, text, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.settle_notification_email_for(uuid, text, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.purge_email_delivery_history()', 'EXECUTE'),
  'service_role executa a superficie do dispatcher'
);
select ok(
  has_function_privilege('authenticated', 'public.notification_email_dispatcher_healthy(integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.notification_email_dispatcher_healthy(integer)', 'EXECUTE'),
  'saude do dispatcher: sessao le, anon nao'
);
select ok(
  not has_table_privilege('authenticated', 'public.notification_dispatch_runs', 'SELECT')
  and not has_table_privilege('anon', 'public.notification_dispatch_runs', 'SELECT'),
  'execucoes do dispatcher nao sao legiveis pela sessao'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"96290000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select * from public.due_notification_emails('America/Sao_Paulo', 10) $$,
  '42501', null, 'authenticated recebe permissao negada em due_notification_emails'
);
select throws_ok(
  $$ select public.enqueue_notification_email_for('96290000-0000-4000-8000-000000000002', 'weekly_digest', 'weekly_digest:2026-W39', 'brevo', 's', 'b') $$,
  '42501', null, 'authenticated nao enfileira para outra pessoa'
);
reset role;

-- ---------------------------------------------------------------------------
-- 2. service_role real: sem sub. E-mail desligado por padrao.
-- ---------------------------------------------------------------------------

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(auth.uid(), null, 'a chamada de service_role nao tem titular nas claims');

select is(
  (select count(*)::int from public.due_notification_emails('America/Sao_Paulo', 50)
   where user_id in ('96290000-0000-4000-8000-000000000001', '96290000-0000-4000-8000-000000000002')),
  0,
  'canal e-mail nasce desligado: ninguem elegivel'
);

reset role;
update public.notification_preferences set enabled = true
where user_id in ('96290000-0000-4000-8000-000000000001', '96290000-0000-4000-8000-000000000002')
  and channel = 'email';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(
  (select array_agg(kind order by kind) from public.due_notification_emails('America/Sao_Paulo', 50)
   where user_id = '96290000-0000-4000-8000-000000000001'),
  array['checkin_reminder', 'weekly_digest']::text[],
  'ligado: check-in (sem registro hoje) e resumo; metas nao (sem meta ativa); system_notice nunca'
);
select is(
  (select count(*)::int from public.due_notification_emails('America/Sao_Paulo', 50)
   where user_id = '96290000-0000-4000-8000-000000000002'),
  0,
  'endereco nao confirmado nunca e elegivel'
);
select is(
  (select event_key from public.due_notification_emails('America/Sao_Paulo', 50)
   where user_id = '96290000-0000-4000-8000-000000000001' and kind = 'weekly_digest'),
  'weekly_digest:' || to_char((now() at time zone 'America/Sao_Paulo')::date, 'IYYY-"W"IW'),
  'resumo usa a semana ISO no fuso da instalacao'
);
select is(
  (select event_key from public.due_notification_emails('America/Sao_Paulo', 50)
   where user_id = '96290000-0000-4000-8000-000000000001' and kind = 'checkin_reminder'),
  'checkin_reminder:' || to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD'),
  'lembrete diario usa o dia no fuso da instalacao'
);

select throws_ok(
  $$ select * from public.due_notification_emails('Marte/Base', 10) $$,
  '22023', 'invalid timezone', 'fuso invalido e recusado'
);
select throws_ok(
  $$ select * from public.due_notification_emails('America/Sao_Paulo', 0) $$,
  '22023', 'invalid limit', 'lote zero e recusado'
);
select throws_ok(
  $$ select * from public.due_notification_emails('America/Sao_Paulo', 501) $$,
  '22023', 'invalid limit', 'lote acima de 500 e recusado'
);

-- ---------------------------------------------------------------------------
-- 3. Eventos: check-in de hoje e meta ativa
-- ---------------------------------------------------------------------------

reset role;
insert into public.emotional_checkins (user_id, mood_score, occurred_at)
values ('96290000-0000-4000-8000-000000000001', 6, now());
insert into public.goals (user_id, title, kind, recurrence, target, status)
values ('96290000-0000-4000-8000-000000000001', 'Caminhar', 'frequency', 'daily', 1, 'active');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(
  (select array_agg(kind order by kind) from public.due_notification_emails('America/Sao_Paulo', 50)
   where user_id = '96290000-0000-4000-8000-000000000001'),
  array['goal_reminder', 'weekly_digest']::text[],
  'check-in de hoje apaga o lembrete; meta ativa cria o de metas'
);

-- ---------------------------------------------------------------------------
-- 4. Snooze: adiado nao entrega; expirado volta
-- ---------------------------------------------------------------------------

reset role;
update public.notification_preferences set snoozed_until = now() + interval '1 day'
where user_id = '96290000-0000-4000-8000-000000000001' and kind = 'weekly_digest' and channel = 'email';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(
  (select count(*)::int from public.due_notification_emails('America/Sao_Paulo', 50)
   where user_id = '96290000-0000-4000-8000-000000000001' and kind = 'weekly_digest'),
  0,
  'snooze vigente tira o resumo do lote'
);
select is(
  public.enqueue_notification_email_for('96290000-0000-4000-8000-000000000001', 'weekly_digest',
    'weekly_digest:2026-W39', 'brevo', 'Seu resumo', 'Convite'),
  null,
  'snooze vigente tambem recusa enfileirar direto'
);

reset role;
update public.notification_preferences set snoozed_until = now() - interval '1 minute'
where user_id = '96290000-0000-4000-8000-000000000001' and kind = 'weekly_digest' and channel = 'email';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(
  (select count(*)::int from public.due_notification_emails('America/Sao_Paulo', 50)
   where user_id = '96290000-0000-4000-8000-000000000001' and kind = 'weekly_digest'),
  1,
  'snooze expirado devolve o resumo ao lote'
);

-- ---------------------------------------------------------------------------
-- 5. Idempotencia e liquidacao
-- ---------------------------------------------------------------------------

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to service_role;

insert into ids values ('digest', public.enqueue_notification_email_for(
  '96290000-0000-4000-8000-000000000001', 'weekly_digest', 'weekly_digest:2026-W39',
  'brevo', 'Seu resumo', 'Convite'));

select isnt((select id from ids where name = 'digest'), null, 'primeira execucao ganha a janela');
select is(
  public.enqueue_notification_email_for('96290000-0000-4000-8000-000000000001', 'weekly_digest',
    'weekly_digest:2026-W39', 'brevo', 'Seu resumo', 'Convite'),
  null,
  'segunda execucao na mesma janela (pendente) nao ganha nada'
);
select is(
  (select count(*)::int from public.email_deliveries
   where user_id = '96290000-0000-4000-8000-000000000001' and event_key = 'weekly_digest:2026-W39'),
  1,
  'uma linha por janela'
);

select ok(
  public.settle_notification_email_for((select id from ids where name = 'digest'), 'sent'),
  'brevo liquida como sent'
);
select is(
  (select status from public.email_deliveries where id = (select id from ids where name = 'digest')),
  'sent',
  'status real gravado'
);
select ok(
  not public.settle_notification_email_for((select id from ids where name = 'digest'), 'failed', 'http_503'),
  'replay de liquidacao nao reescreve entrega ja registrada'
);
select is(
  public.enqueue_notification_email_for('96290000-0000-4000-8000-000000000001', 'weekly_digest',
    'weekly_digest:2026-W39', 'brevo', 'Seu resumo', 'Convite'),
  null,
  'janela entregue nunca reenvia'
);

insert into ids values ('capture', public.enqueue_notification_email_for(
  '96290000-0000-4000-8000-000000000001', 'goal_reminder', 'goal_reminder:2026-09-25',
  'mailpit', 'Metas', 'Convite'));
select throws_ok(
  format($$ select public.settle_notification_email_for(%L, 'sent') $$, (select id from ids where name = 'capture')),
  '23514', null, 'captura nunca vira sent'
);
select ok(
  public.settle_notification_email_for((select id from ids where name = 'capture'), 'captured'),
  'captura liquida como captured'
);

-- ---------------------------------------------------------------------------
-- 6. Retry finito, so para falha transitoria
-- ---------------------------------------------------------------------------

insert into ids values ('transient', public.enqueue_notification_email_for(
  '96290000-0000-4000-8000-000000000001', 'checkin_reminder', 'checkin_reminder:2026-09-20',
  'brevo', 'Check-in', 'Convite'));
select ok(public.settle_notification_email_for((select id from ids where name = 'transient'), 'failed', 'http_503'),
  'falha 503 liquidada');
select is(
  public.enqueue_notification_email_for('96290000-0000-4000-8000-000000000001', 'checkin_reminder',
    'checkin_reminder:2026-09-20', 'brevo', 'Check-in', 'Convite'),
  (select id from ids where name = 'transient'),
  'falha transitoria reabre a MESMA linha'
);
select ok(public.settle_notification_email_for((select id from ids where name = 'transient'), 'failed', 'http_429'),
  'segunda falha transitoria');
select isnt(
  public.enqueue_notification_email_for('96290000-0000-4000-8000-000000000001', 'checkin_reminder',
    'checkin_reminder:2026-09-20', 'brevo', 'Check-in', 'Convite'),
  null,
  'ainda dentro do teto: reabre'
);
select ok(public.settle_notification_email_for((select id from ids where name = 'transient'), 'failed', 'http_500'),
  'terceira falha transitoria');
select is(
  public.enqueue_notification_email_for('96290000-0000-4000-8000-000000000001', 'checkin_reminder',
    'checkin_reminder:2026-09-20', 'brevo', 'Check-in', 'Convite'),
  null,
  'teto de 3 liquidacoes: retry termina'
);

insert into ids values ('unknown', public.enqueue_notification_email_for(
  '96290000-0000-4000-8000-000000000001', 'checkin_reminder', 'checkin_reminder:2026-09-21',
  'brevo', 'Check-in', 'Convite'));
select ok(public.settle_notification_email_for((select id from ids where name = 'unknown'), 'failed', 'timeout'),
  'timeout liquidado');
select is(
  public.enqueue_notification_email_for('96290000-0000-4000-8000-000000000001', 'checkin_reminder',
    'checkin_reminder:2026-09-21', 'brevo', 'Check-in', 'Convite'),
  null,
  'desfecho desconhecido (timeout) nunca reenvia: evitar duplicata'
);

insert into ids values ('permanent', public.enqueue_notification_email_for(
  '96290000-0000-4000-8000-000000000001', 'checkin_reminder', 'checkin_reminder:2026-09-22',
  'brevo', 'Check-in', 'Convite'));
select ok(public.settle_notification_email_for((select id from ids where name = 'permanent'), 'failed', 'Recusado <x@y>'),
  'falha com texto livre liquidada');
select is(
  (select failure_code from public.email_deliveries where id = (select id from ids where name = 'permanent')),
  'transport_error',
  'texto de provedor nunca chega ao banco: vira rotulo fechado'
);
select is(
  public.enqueue_notification_email_for('96290000-0000-4000-8000-000000000001', 'checkin_reminder',
    'checkin_reminder:2026-09-22', 'brevo', 'Check-in', 'Convite'),
  null,
  'falha nao transitoria nunca reenvia'
);

select throws_ok(
  $$ select public.enqueue_notification_email_for(null, 'weekly_digest', 'weekly_digest:2026-W39', 'brevo', 's', 'b') $$,
  '22023', 'user required', 'titular nulo recusado'
);
select throws_ok(
  $$ select public.enqueue_notification_email_for('96290000-0000-4000-8000-000000000001', 'marketing', 'marketing:2026-09-25', 'brevo', 's', 'b') $$,
  '22023', 'invalid kind', 'tipo fora do contrato recusado'
);

-- ---------------------------------------------------------------------------
-- 7. Saude, cota e retencao
-- ---------------------------------------------------------------------------

select ok(not public.notification_email_dispatcher_healthy(60), 'sem execucao concluida, dispatcher nao esta saudavel');
insert into public.notification_dispatch_runs (transport, outcome, finished_at)
values ('mailpit', 'completed', timezone('utc', now()));
select ok(public.notification_email_dispatcher_healthy(60), 'execucao concluida recente torna o canal real');

select ok(
  public.email_deliveries_used_since(now() - interval '1 day') >= 2,
  'cota conta entregas e pendencias das ultimas 24 h'
);

reset role;
insert into public.email_deliveries (user_id, kind, event_key, transport, status, subject, body, created_at, updated_at)
values ('96290000-0000-4000-8000-000000000001', 'checkin_reminder', 'checkin_reminder:2026-01-01',
        'brevo', 'failed', 'Antigo', 'Convite', now() - interval '200 days', now() - interval '200 days');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select ok(public.purge_email_delivery_history() >= 1, 'retencao remove registro com mais de 180 dias');
select is(
  (select count(*)::int from public.email_deliveries where user_id = '96290000-0000-4000-8000-000000000001'),
  5,
  'retencao preserva o que e recente'
);

select * from finish();
rollback;
