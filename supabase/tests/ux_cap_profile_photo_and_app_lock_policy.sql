-- Gate UX-CAP — politica de inatividade e caminho privado da foto de perfil.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(13);

select has_column('public', 'app_lock_sessions', 'idle_policy', 'App Lock possui politica de inatividade');
select col_default_is(
  'public', 'app_lock_sessions', 'idle_policy', '5m',
  'politica herdada continua em cinco minutos'
);
select has_column('public', 'profiles', 'avatar_path', 'perfil possui ponteiro privado de avatar');

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
    '99000000-0000-4000-8000-000000000101',
    'authenticated', 'authenticated', 'ux-cap-a@elyra.invalid', null,
    timezone('utc', now()), '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Pessoa UX A"}'::jsonb,
    timezone('utc', now()), timezone('utc', now())
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '99000000-0000-4000-8000-000000000102',
    'authenticated', 'authenticated', 'ux-cap-b@elyra.invalid', null,
    timezone('utc', now()), '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Pessoa UX B"}'::jsonb,
    timezone('utc', now()), timezone('utc', now())
  );

insert into public.app_lock_sessions (
  user_id, session_id, lock_id, state, pin_salt, pin_verifier
)
values (
  '99000000-0000-4000-8000-000000000101',
  '99000000-0000-4000-8000-000000000201',
  '99000000-0000-4000-8000-000000000301',
  'UNLOCKED', 'salt-a', 'verifier-a'
);

select throws_ok(
  $$update public.app_lock_sessions set idle_policy = 'seconds'
    where user_id = '99000000-0000-4000-8000-000000000101'$$,
  '23514', null,
  'prazo fora do contrato e recusado'
);
select lives_ok(
  $$update public.app_lock_sessions set idle_policy = 'never'
    where user_id = '99000000-0000-4000-8000-000000000101'$$,
  'never e politica valida sem remover lock manual'
);
select is(
  (select idle_policy from public.app_lock_sessions
    where user_id = '99000000-0000-4000-8000-000000000101'),
  'never',
  'politica valida persiste'
);

select lives_ok(
  $$update public.profiles
    set avatar_path = '99000000-0000-4000-8000-000000000101/profile/99000000-0000-4000-8000-000000000401.webp'
    where user_id = '99000000-0000-4000-8000-000000000101'$$,
  'perfil aceita apenas caminho privado do proprio owner'
);
select throws_ok(
  $$update public.profiles
    set avatar_path = '99000000-0000-4000-8000-000000000102/profile/99000000-0000-4000-8000-000000000402.webp'
    where user_id = '99000000-0000-4000-8000-000000000101'$$,
  '23514', null,
  'perfil recusa caminho pertencente a outra pessoa'
);
select throws_ok(
  $$update public.profiles
    set avatar_path = '99000000-0000-4000-8000-000000000101/profile/active.svg'
    where user_id = '99000000-0000-4000-8000-000000000101'$$,
  '23514', null,
  'perfil recusa formato ativo e nome fora do contrato'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"99000000-0000-4000-8000-000000000101","role":"authenticated","session_id":"99000000-0000-4000-8000-000000000201"}';

select is(
  (select count(*)::integer from public.profiles),
  1,
  'RLS deixa A ver somente o proprio perfil'
);
select is(
  (select count(*)::integer from public.profiles
    where user_id = '99000000-0000-4000-8000-000000000102'),
  0,
  'A nao le o ponteiro de foto de B'
);
select is(
  (select count(*)::integer from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname like 'private_bucket_%_own'),
  4,
  'Storage privado preserva as quatro policies owner-only'
);
select results_eq(
  $$update public.profiles
      set avatar_path = null
    where user_id = '99000000-0000-4000-8000-000000000102'
    returning user_id$$,
  array[]::uuid[],
  'A nao altera o perfil de B'
);

reset role;
select * from finish();
rollback;
