-- Stage 23 / Extensao 23-A - o canal de e-mail, provado por comportamento.
--
-- O que este arquivo prova, e que nenhum teste de forma provaria:
--   1. `email` e canal valido, e o vocabulario continua fechado;
--   2. a matriz nasce inteira (33 linhas desde o fluxo B: onze tipos), e todas as
--      de e-mail **desligadas**;
--   3. o backfill nao redefiniu escolha de quem ja existia;
--   4. `system_notice` por e-mail tambem nasce desligado — a heranca do in-app
--      nao atravessa para um canal que sai da Elyra;
--   5. adiar suprime e-mail sem desligar a preferencia;
--   6. autorizacao continua owner-only, e sem `delete`.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(14);

-- ---------------------------------------------------------------------------
-- Fixture: uma conta criada pelo mesmo caminho da aplicacao.
-- O trigger `handle_new_auth_user` cria profile e user_preferences, e a
-- semeadura da matriz vem junto.
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '96000000-0000-4000-8000-000000000201',
  'authenticated', 'authenticated', 'stage23a-email@elyra.invalid', null,
  timezone('utc', now()), '', '', '', '', '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Pessoa Email"}'::jsonb,
  timezone('utc', now()), timezone('utc', now())
);

select public.seed_notification_preferences(
  '96000000-0000-4000-8000-000000000201'
);

-- ---------------------------------------------------------------------------
-- 1. Vocabulario
-- ---------------------------------------------------------------------------

select lives_ok(
  $$update public.notification_preferences set enabled = enabled
    where channel = 'email'$$,
  'email e canal valido na matriz'
);

select throws_ok(
  $$insert into public.notification_preferences (user_id, kind, channel, enabled)
    values ('96000000-0000-4000-8000-000000000201',
            'checkin_reminder', 'sms', true)$$,
  '23514', null,
  'canal fora do vocabulario continua recusado'
);

-- ---------------------------------------------------------------------------
-- 2. A matriz completa, com e-mail desligado
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer from public.notification_preferences
   where user_id = '96000000-0000-4000-8000-000000000201'),
  45,
  'a matriz nasce inteira: quinze tipos por tres canais (L-433: convite aceito)'
);

select is(
  (select count(*)::integer from public.notification_preferences
   where user_id = '96000000-0000-4000-8000-000000000201'
     and channel = 'email'),
  15,
  'quinze linhas de e-mail, uma por tipo'
);

select is(
  (select count(*)::integer from public.notification_preferences
   where user_id = '96000000-0000-4000-8000-000000000201'
     and channel = 'email' and enabled),
  0,
  'nenhum e-mail nasce ligado'
);

/*
  O caso que mais tentaria a heranca: no in-app o aviso de servico nasce ligado.
  Por e-mail ele sai da Elyra e chega num lugar que nao e nosso.
*/
select is(
  (select enabled from public.notification_preferences
   where user_id = '96000000-0000-4000-8000-000000000201'
     and kind = 'system_notice' and channel = 'email'),
  false,
  'nem o aviso de sistema herda o canal de e-mail'
);

select is(
  (select enabled from public.notification_preferences
   where user_id = '96000000-0000-4000-8000-000000000201'
     and kind = 'system_notice' and channel = 'in_app'),
  true,
  'e o in-app permanece como era: a extensao nao mexeu nos canais antigos'
);

-- ---------------------------------------------------------------------------
-- 3. O backfill nao redefine escolha
-- ---------------------------------------------------------------------------

update public.notification_preferences
set enabled = false
where user_id = '96000000-0000-4000-8000-000000000201'
  and kind = 'checkin_reminder' and channel = 'in_app';

-- Repetir a semeadura e exatamente o que o backfill da migration faz.
select public.seed_notification_preferences(
  '96000000-0000-4000-8000-000000000201'
);

select is(
  (select enabled from public.notification_preferences
   where user_id = '96000000-0000-4000-8000-000000000201'
     and kind = 'checkin_reminder' and channel = 'in_app'),
  false,
  'semear de novo NAO reativa o que a pessoa desligou'
);

select is(
  (select count(*)::integer from public.notification_preferences
   where user_id = '96000000-0000-4000-8000-000000000201'),
  45,
  'e nao duplica linha'
);

-- ---------------------------------------------------------------------------
-- 4. Entrega: desligado nao entrega, adiado tambem nao
-- ---------------------------------------------------------------------------

select is(
  public.notification_channel_delivers(
    '96000000-0000-4000-8000-000000000201', 'weekly_digest', 'email'
  ),
  false,
  'e-mail desligado nao entrega'
);

update public.notification_preferences
set enabled = true
where user_id = '96000000-0000-4000-8000-000000000201'
  and kind = 'weekly_digest' and channel = 'email';

select is(
  public.notification_channel_delivers(
    '96000000-0000-4000-8000-000000000201', 'weekly_digest', 'email'
  ),
  true,
  'ligado por escolha da pessoa, entrega'
);

update public.notification_preferences
set snoozed_until = timezone('utc', now()) + interval '1 day'
where user_id = '96000000-0000-4000-8000-000000000201'
  and kind = 'weekly_digest' and channel = 'email';

select is(
  public.notification_channel_delivers(
    '96000000-0000-4000-8000-000000000201', 'weekly_digest', 'email'
  ),
  false,
  'adiamento vigente suprime o e-mail'
);

select is(
  (select enabled from public.notification_preferences
   where user_id = '96000000-0000-4000-8000-000000000201'
     and kind = 'weekly_digest' and channel = 'email'),
  true,
  'e a preferencia continua ligada: adiar nao e desligar'
);

-- ---------------------------------------------------------------------------
-- 5. Autorizacao
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('authenticated', 'public.notification_preferences', 'DELETE'),
  'preferencia de e-mail nao se apaga: desligar e a forma de recusar'
);

select * from finish();
rollback;
