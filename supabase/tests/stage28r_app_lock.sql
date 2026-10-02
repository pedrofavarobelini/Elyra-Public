-- Stage 28-R / Gate S2 — isolamento do App Lock por pessoa e sessão.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(15);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '98000000-0000-4000-8000-000000000101',
    'authenticated', 'authenticated', 'stage28r-a@elyra.invalid', null,
    timezone('utc', now()), '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Pessoa App Lock A"}'::jsonb,
    timezone('utc', now()), timezone('utc', now())
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '98000000-0000-4000-8000-000000000102',
    'authenticated', 'authenticated', 'stage28r-b@elyra.invalid', null,
    timezone('utc', now()), '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Pessoa App Lock B"}'::jsonb,
    timezone('utc', now()), timezone('utc', now())
  );

select has_table('public', 'app_lock_sessions', 'tabela de App Lock existe');
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.app_lock_sessions'::regclass),
  'App Lock usa RLS forcada'
);
select ok(
  not has_table_privilege('anon', 'public.app_lock_sessions', 'SELECT')
  and not has_table_privilege('anon', 'public.app_lock_sessions', 'INSERT')
  and not has_table_privilege('anon', 'public.app_lock_sessions', 'UPDATE')
  and not has_table_privilege('anon', 'public.app_lock_sessions', 'DELETE'),
  'anon nao acessa o material do App Lock'
);
select ok(
  has_table_privilege('authenticated', 'public.app_lock_sessions', 'SELECT')
  and has_table_privilege('authenticated', 'public.app_lock_sessions', 'INSERT')
  and has_table_privilege('authenticated', 'public.app_lock_sessions', 'UPDATE')
  and has_table_privilege('authenticated', 'public.app_lock_sessions', 'DELETE'),
  'authenticated tem operacoes sujeitas a RLS'
);

insert into public.app_lock_sessions (
  user_id, session_id, lock_id, state, pin_salt, pin_verifier, unlocked_until
)
values
  (
    '98000000-0000-4000-8000-000000000101',
    '98000000-0000-4000-8000-000000000201',
    '98000000-0000-4000-8000-000000000301',
    'LOCKED', 'salt-a1', 'verifier-a1', null
  ),
  (
    '98000000-0000-4000-8000-000000000101',
    '98000000-0000-4000-8000-000000000202',
    '98000000-0000-4000-8000-000000000302',
    'LOCKED', 'salt-a2', 'verifier-a2', null
  ),
  (
    '98000000-0000-4000-8000-000000000102',
    '98000000-0000-4000-8000-000000000203',
    '98000000-0000-4000-8000-000000000303',
    'LOCKED', 'salt-b1', 'verifier-b1', null
  );

select throws_ok(
  $$insert into public.app_lock_sessions
    (user_id, session_id, lock_id, state, pin_salt, pin_verifier, failed_attempts)
    values ('98000000-0000-4000-8000-000000000101',
            '98000000-0000-4000-8000-000000000204',
            '98000000-0000-4000-8000-000000000304',
            'LOCKED', 'salt', 'verifier', -1)$$,
  '23514', null,
  'contador negativo e recusado'
);
select throws_ok(
  $$insert into public.app_lock_sessions
    (user_id, session_id, lock_id, state, pin_salt, pin_verifier)
    values ('98000000-0000-4000-8000-000000000101',
            '98000000-0000-4000-8000-000000000204',
            '98000000-0000-4000-8000-000000000304',
            'DISABLED', 'salt', 'verifier')$$,
  '23514', null,
  'estado fora do contrato persistido e recusado'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"98000000-0000-4000-8000-000000000101","role":"authenticated","session_id":"98000000-0000-4000-8000-000000000201"}';

select is(
  (select count(*)::integer from public.app_lock_sessions),
  1,
  'sessao A1 enxerga somente o proprio bloqueio'
);
select is(
  (select lock_id from public.app_lock_sessions),
  '98000000-0000-4000-8000-000000000301'::uuid,
  'a linha visivel pertence exatamente a sessao A1'
);
select throws_ok(
  $$insert into public.app_lock_sessions
    (user_id, session_id, lock_id, state, pin_salt, pin_verifier)
    values ('98000000-0000-4000-8000-000000000101',
            '98000000-0000-4000-8000-000000000204',
            '98000000-0000-4000-8000-000000000304',
            'LOCKED', 'salt', 'verifier')$$,
  '42501', null,
  'sessao A1 nao cria bloqueio para outra sessao'
);
select results_eq(
  $$update public.app_lock_sessions set failed_attempts = 4 returning failed_attempts$$,
  array[4],
  'sessao A1 atualiza a propria contagem'
);
select is(
  (select count(*)::integer from public.app_lock_sessions where failed_attempts = 4),
  1,
  'update nao alcanca outra sessao da mesma pessoa'
);
select lives_ok(
  $$delete from public.app_lock_sessions
    where user_id = '98000000-0000-4000-8000-000000000101'$$,
  'delete da pessoa continua limitado a sessao corrente'
);
select is(
  (select count(*)::integer from public.app_lock_sessions),
  0,
  'sessao A1 nao ve linhas vizinhas depois de apagar a propria'
);

set local request.jwt.claims =
  '{"sub":"98000000-0000-4000-8000-000000000101","role":"authenticated","session_id":"98000000-0000-4000-8000-000000000202"}';
select is(
  (select count(*)::integer from public.app_lock_sessions),
  1,
  'a segunda sessao de A preserva e ve somente o proprio bloqueio'
);

set local request.jwt.claims =
  '{"sub":"98000000-0000-4000-8000-000000000102","role":"authenticated","session_id":"98000000-0000-4000-8000-000000000203"}';
select is(
  (select count(*)::integer from public.app_lock_sessions),
  1,
  'a pessoa B permanece isolada de A'
);

reset role;
select * from finish();
rollback;
