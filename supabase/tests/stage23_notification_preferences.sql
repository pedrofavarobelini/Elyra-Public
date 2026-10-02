-- Stage 23 / Gate 23-A - a matriz canal x tipo, provada por comportamento.
--
-- O que este arquivo prova, e que nenhum teste de forma provaria:
--   1. a matriz nasce inteira e com os defaults corretos - push desligado,
--      digest desligado, e o in-app herdando o que a pessoa ja tinha;
--   2. a face legada continua mandando: escrever na coluna antiga muda a
--      matriz, que e o que a materializacao le;
--   3. adiar nao e desligar - `snoozed_until` suprime a entrega e a preferencia
--      continua ligada;
--   4. o vocabulario ampliado vale nas **duas** constraints de `notifications`
--      (a licao do `L-159`);
--   5. autorizacao owner-only, sem `delete`, como em `user_preferences`.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

-- ---------------------------------------------------------------------------
-- Fixture: um usuario real, criado pelo mesmo caminho da aplicacao.
-- `handle_new_auth_user` cria profile + user_preferences, e o trigger novo
-- semeia a matriz. Se a cadeia quebrar, os proximos asserts falham por si.
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000', '96000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'stage23-notificacao@elyra.invalid', null,
  timezone('utc', now()), '', '', '', '', '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Pessoa Notificacao"}'::jsonb,
  timezone('utc', now()), timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- 1. Estrutura e autorizacao
-- ---------------------------------------------------------------------------

select has_table(
  'public', 'notification_preferences', 'a matriz de preferencia existe'
);

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.notification_preferences'::regclass),
  'notification_preferences usa RLS forcada'
);

select has_trigger(
  'public', 'notification_preferences', 'notification_preferences_set_updated_at',
  'a matriz atualiza timestamp'
);

select has_trigger(
  'public', 'user_preferences', 'user_preferences_sync_notification_matrix',
  'a face legada propaga para a matriz'
);

select ok(
  has_table_privilege('authenticated', 'public.notification_preferences', 'SELECT')
  and has_table_privilege('authenticated', 'public.notification_preferences', 'UPDATE'),
  'authenticated le e atualiza a propria preferencia sob RLS'
);

select ok(
  not has_table_privilege('authenticated', 'public.notification_preferences', 'DELETE'),
  'preferencia nao e apagada: desligar e a forma de recusar'
);

select ok(
  not has_table_privilege('anon', 'public.notification_preferences', 'SELECT'),
  'anon nao le preferencia de ninguem'
);

select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public' and tablename = 'notification_preferences'),
  3,
  'tres policies owner-only: select, insert e update'
);

-- ---------------------------------------------------------------------------
-- 2. Semeadura e defaults
-- ---------------------------------------------------------------------------

/*
  Doze desde a extensao do 23-A, que acrescentou o canal `email`.

  A assercao mudou de numero, e nao de intencao: a matriz continua tendo de
  nascer **inteira**, porque linha ausente obrigaria cada leitor a decidir o que
  fazer com a ausencia — e cada um decidiria diferente. O teste de que o canal
  novo nasce desligado vive em `stage23a_email_channel.sql`.

  Vinte e quatro desde o PRO-6 (Stage 29), que acrescentou os quatro tipos de
  agenda (`appointment_*`); vinte e sete com `session_ready` (PRO-7); trinta e tres com `connection_requested`
  e `relationship_created` (fluxo B). Mesma
  intencao: a matriz nasce inteira.
*/
select is(
  (select count(*)::integer from public.notification_preferences
   where user_id = '96000000-0000-4000-8000-000000000001'),
  45,
  'a matriz nasce inteira: quinze tipos por tres canais (L-433: convite aceito)'
);

select is(
  (select count(*)::integer from public.notification_preferences
   where user_id = '96000000-0000-4000-8000-000000000001'
     and channel = 'web_push' and enabled),
  0,
  'nenhum push nasce ligado'
);

select is(
  (select enabled from public.notification_preferences
   where user_id = '96000000-0000-4000-8000-000000000001'
     and kind = 'weekly_digest' and channel = 'in_app'),
  false,
  'o resumo semanal e opt-in'
);

select is(
  (select enabled from public.notification_preferences
   where user_id = '96000000-0000-4000-8000-000000000001'
     and kind = 'checkin_reminder' and channel = 'in_app'),
  true,
  'o in-app herda a preferencia que ja existia'
);

-- ---------------------------------------------------------------------------
-- 3. A face legada continua mandando
-- ---------------------------------------------------------------------------

update public.user_preferences
set goal_reminder = false
where user_id = '96000000-0000-4000-8000-000000000001';

select is(
  (select enabled from public.notification_preferences
   where user_id = '96000000-0000-4000-8000-000000000001'
     and kind = 'goal_reminder' and channel = 'in_app'),
  false,
  'desligar na coluna legada desliga o par in-app'
);

update public.user_preferences
set goal_reminder = true
where user_id = '96000000-0000-4000-8000-000000000001';

select is(
  (select enabled from public.notification_preferences
   where user_id = '96000000-0000-4000-8000-000000000001'
     and kind = 'goal_reminder' and channel = 'in_app'),
  true,
  'religar na coluna legada religa o par in-app'
);

-- ---------------------------------------------------------------------------
-- 4. Adiar nao e desligar
-- ---------------------------------------------------------------------------

update public.notification_preferences
set snoozed_until = timezone('utc', now()) + interval '1 day'
where user_id = '96000000-0000-4000-8000-000000000001'
  and kind = 'goal_reminder' and channel = 'in_app';

select is(
  public.notification_channel_delivers(
    '96000000-0000-4000-8000-000000000001', 'goal_reminder', 'in_app'
  ),
  false,
  'adiamento vigente suprime a entrega'
);

select is(
  (select enabled from public.notification_preferences
   where user_id = '96000000-0000-4000-8000-000000000001'
     and kind = 'goal_reminder' and channel = 'in_app'),
  true,
  'e a preferencia continua ligada: adiar nao e recusar'
);

-- ---------------------------------------------------------------------------
-- 5. Vocabulario ampliado nas DUAS constraints (L-159)
-- ---------------------------------------------------------------------------

select lives_ok(
  $$insert into public.notifications (user_id, kind, event_key)
    values ('96000000-0000-4000-8000-000000000001',
            'weekly_digest', 'weekly_digest:2026-W37')$$,
  'o tipo novo e aceito com a janela semanal'
);

select throws_ok(
  $$insert into public.notifications (user_id, kind, event_key)
    values ('96000000-0000-4000-8000-000000000001',
            'weekly_digest', 'weekly_digest:2026-09-11')$$,
  '23514', null,
  'janela diaria e recusada para o resumo semanal'
);

select * from finish();
rollback;
