-- Seed exclusivamente sintetico. Nenhuma senha, token ou dado humano e versionado.
-- As identidades abaixo nao possuem credencial de login: existem para replay de
-- ownership/RLS. Testes de Auth criam usuarios efemeros e os removem no cleanup.

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  email_change_token_current,
  phone_change,
  phone_change_token,
  reauthentication_token,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'qa-owner-a@elyra.invalid',
    null,
    timezone('utc', now()),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Pessoa QA A"}'::jsonb,
    timezone('utc', now()),
    timezone('utc', now())
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'qa-owner-b@elyra.invalid',
    null,
    timezone('utc', now()),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Pessoa QA B"}'::jsonb,
    timezone('utc', now()),
    timezone('utc', now())
  )
on conflict (id) do nothing;

insert into public.consent_events (
  id, user_id, purpose, document_version, event_type, occurred_at
)
values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'terms_privacy',
  'v1',
  'granted',
  timezone('utc', now())
)
on conflict (id) do nothing;

insert into public.audit_logs (
  id, actor_user_id, action, entity_type, entity_id, outcome, correlation_id, occurred_at
)
values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'qa.seed.created',
  'profile',
  '10000000-0000-4000-8000-000000000001',
  'success',
  '40000000-0000-4000-8000-000000000001',
  timezone('utc', now())
)
on conflict (id) do nothing;
