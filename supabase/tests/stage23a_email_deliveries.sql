-- Stage 23 / Extensao 23-A - entrega de e-mail, provada por comportamento.
--
-- O que este arquivo prova:
--   1. preferencia desligada nao enfileira;
--   2. ligada, enfileira uma vez;
--   3. a segunda tentativa da mesma janela nao cria segunda entrega;
--   4. adiamento suprime sem desligar;
--   5. falha de transporte NAO marca entrega, e o retry reaproveita a linha;
--   6. janela errada para o tipo e recusada;
--   7. autorizacao: leitura owner-only, escrita so pela RPC.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '96000000-0000-4000-8000-000000000301',
  'authenticated', 'authenticated', 'stage23a-entrega@elyra.invalid', null,
  timezone('utc', now()), '', '', '', '', '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Pessoa Entrega"}'::jsonb,
  timezone('utc', now()), timezone('utc', now())
);

select public.seed_notification_preferences(
  '96000000-0000-4000-8000-000000000301'
);

-- ---------------------------------------------------------------------------
-- 1. Estrutura e autorizacao
-- ---------------------------------------------------------------------------

select has_table('public', 'email_deliveries', 'a tabela de entregas existe');

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.email_deliveries'::regclass),
  'email_deliveries usa RLS forcada'
);

select ok(
  has_table_privilege('authenticated', 'public.email_deliveries', 'SELECT'),
  'a pessoa audita o que lhe foi enviado'
);

/*
  O ponto de seguranca: se `authenticated` pudesse inserir aqui, qualquer um
  forjaria a propria entrega e o teto de frequencia deixaria de valer.
*/
select ok(
  not has_table_privilege('authenticated', 'public.email_deliveries', 'INSERT')
  and not has_table_privilege('authenticated', 'public.email_deliveries', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.email_deliveries', 'DELETE'),
  'escrita e privilegio da RPC, e nao do cliente'
);

select ok(
  not has_table_privilege('anon', 'public.email_deliveries', 'SELECT'),
  'anon nao le entrega de ninguem'
);

/*
  `F-23E-01`. As duas RPCs nasceram executaveis por `authenticated`, e a de
  enfileiramento recebe assunto e corpo **do chamador** — o que deixava a regra
  "nenhum conteudo sensivel em e-mail" valendo so nos templates em TypeScript, e
  nao na fronteira. Entrega de engajamento e acao iniciada pelo sistema, entao o
  papel certo e `service_role`.
*/
select ok(
  not has_function_privilege(
    'authenticated',
    'public.enqueue_notification_email(text, text, text, text, text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.settle_notification_email(uuid, boolean, text)',
    'EXECUTE'
  ),
  'o cliente nao enfileira nem liquida entrega de e-mail'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.enqueue_notification_email(text, text, text, text, text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.settle_notification_email(uuid, boolean, text)',
    'EXECUTE'
  ),
  'o agendador, quando existir, encontra o papel certo'
);

-- ---------------------------------------------------------------------------
-- 2. Preferencia governa o enfileiramento
-- ---------------------------------------------------------------------------

/*
  Somente as claims, sem `set role authenticated`.

  Desde o 23-E (`F-23E-01`) as duas RPCs sao `service_role`: enfileirar e
  liquidar entrega e acao iniciada pelo sistema, e nao pela pessoa. As funcoes
  continuam `security definer` e continuam lendo `auth.uid()` das claims, entao
  o comportamento provado aqui e o mesmo — o que mudou foi **quem pode chamar**,
  e isso e verificado por privilegio logo abaixo.
*/
set local request.jwt.claims = '{"sub":"96000000-0000-4000-8000-000000000301","role":"authenticated"}';

select is(
  public.enqueue_notification_email(
    'weekly_digest', 'weekly_digest:2026-W37', 'local_capture',
    'Seu resumo semanal', 'Seu resumo da semana esta disponivel no Elyra.'
  ),
  null,
  'e-mail desligado nao enfileira nada'
);

reset role;

update public.notification_preferences
set enabled = true
where user_id = '96000000-0000-4000-8000-000000000301'
  and kind = 'weekly_digest' and channel = 'email';

/*
  Somente as claims, sem `set role authenticated`.

  Desde o 23-E (`F-23E-01`) as duas RPCs sao `service_role`: enfileirar e
  liquidar entrega e acao iniciada pelo sistema, e nao pela pessoa. As funcoes
  continuam `security definer` e continuam lendo `auth.uid()` das claims, entao
  o comportamento provado aqui e o mesmo — o que mudou foi **quem pode chamar**,
  e isso e verificado por privilegio logo abaixo.
*/
set local request.jwt.claims = '{"sub":"96000000-0000-4000-8000-000000000301","role":"authenticated"}';

select isnt(
  public.enqueue_notification_email(
    'weekly_digest', 'weekly_digest:2026-W37', 'local_capture',
    'Seu resumo semanal', 'Seu resumo da semana esta disponivel no Elyra.'
  ),
  null,
  'ligado por escolha da pessoa, enfileira'
);

-- ---------------------------------------------------------------------------
-- 3. Idempotencia: a mesma janela nao entrega duas vezes
-- ---------------------------------------------------------------------------

select is(
  public.enqueue_notification_email(
    'weekly_digest', 'weekly_digest:2026-W37', 'local_capture',
    'Seu resumo semanal', 'Seu resumo da semana esta disponivel no Elyra.'
  ),
  null,
  'a segunda tentativa da mesma janela nao cria segunda entrega'
);

select is(
  (select count(*)::integer from public.email_deliveries
   where user_id = '96000000-0000-4000-8000-000000000301'),
  1,
  'e a tabela continua com uma unica linha'
);

select isnt(
  public.enqueue_notification_email(
    'weekly_digest', 'weekly_digest:2026-W38', 'local_capture',
    'Seu resumo semanal', 'Seu resumo da semana esta disponivel no Elyra.'
  ),
  null,
  'a janela seguinte e uma entrega nova'
);

-- ---------------------------------------------------------------------------
-- 4. Falha de transporte nao marca entrega
-- ---------------------------------------------------------------------------

select public.settle_notification_email(
  (select id from public.email_deliveries
   where event_key = 'weekly_digest:2026-W38'),
  false,
  'http_500'
);

select is(
  (select status from public.email_deliveries
   where event_key = 'weekly_digest:2026-W38'),
  'failed',
  'transporte que falhou marca falha, e nao entrega'
);

select is(
  (select delivered_at from public.email_deliveries
   where event_key = 'weekly_digest:2026-W38'),
  null,
  'e nao carimba entrega que nao aconteceu'
);

select public.settle_notification_email(
  (select id from public.email_deliveries
   where event_key = 'weekly_digest:2026-W38'),
  true
);

select is(
  (select status from public.email_deliveries
   where event_key = 'weekly_digest:2026-W38'),
  'captured',
  'o retry da mesma janela reaproveita a linha e conclui'
);

reset role;

-- ---------------------------------------------------------------------------
-- 5. Adiamento suprime sem desligar
-- ---------------------------------------------------------------------------

update public.notification_preferences
set snoozed_until = timezone('utc', now()) + interval '1 day'
where user_id = '96000000-0000-4000-8000-000000000301'
  and kind = 'weekly_digest' and channel = 'email';

/*
  Somente as claims, sem `set role authenticated`.

  Desde o 23-E (`F-23E-01`) as duas RPCs sao `service_role`: enfileirar e
  liquidar entrega e acao iniciada pelo sistema, e nao pela pessoa. As funcoes
  continuam `security definer` e continuam lendo `auth.uid()` das claims, entao
  o comportamento provado aqui e o mesmo — o que mudou foi **quem pode chamar**,
  e isso e verificado por privilegio logo abaixo.
*/
set local request.jwt.claims = '{"sub":"96000000-0000-4000-8000-000000000301","role":"authenticated"}';

select is(
  public.enqueue_notification_email(
    'weekly_digest', 'weekly_digest:2026-W39', 'local_capture',
    'Seu resumo semanal', 'Seu resumo da semana esta disponivel no Elyra.'
  ),
  null,
  'adiamento vigente suprime a entrega'
);

reset role;

select is(
  (select enabled from public.notification_preferences
   where user_id = '96000000-0000-4000-8000-000000000301'
     and kind = 'weekly_digest' and channel = 'email'),
  true,
  'e a preferencia continua ligada: adiar nao e desligar'
);

-- ---------------------------------------------------------------------------
-- 6. A janela precisa combinar com o tipo
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.email_deliveries
      (user_id, kind, event_key, transport, subject, body)
    values ('96000000-0000-4000-8000-000000000301', 'weekly_digest',
            'weekly_digest:2026-09-12', 'local_capture', 'x', 'y')$$,
  '23514', null,
  'janela diaria e recusada para o resumo semanal'
);

select * from finish();
rollback;
