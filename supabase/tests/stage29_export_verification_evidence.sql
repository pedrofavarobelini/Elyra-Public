-- Stage 29 / Pre-closure - export do titular: evidencia de verificacao sai
-- pela RPC propria (so a conta, sem digest); a tabela segue sem grant.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(7);

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
  ('29ee0000-0000-4000-8000-000000000001'::uuid, 'expev-a@elyra.invalid', 'Pro A'),
  ('29ee0000-0000-4000-8000-000000000002'::uuid, 'expev-b@elyra.invalid', 'Pro B')
) as fixture(id, email, name);

insert into public.professional_profiles (user_id, council_region, registration_number, specialty, verification_status)
values
  ('29ee0000-0000-4000-8000-000000000001', '06', '06/ee0001', 'Psicologia', 'pending'),
  ('29ee0000-0000-4000-8000-000000000002', '06', '06/ee0002', 'Psicologia', 'pending');

insert into public.professional_verification_evidence
  (professional_user_id, submission, fact_type, source_type, provider, status, value_digest, policy_version)
values
  ('29ee0000-0000-4000-8000-000000000001', 1, 'registry_format', 'local_evidence', 'elyra_format', 'PASS', repeat('a', 64), 'v2.0'),
  ('29ee0000-0000-4000-8000-000000000001', 1, 'auth_account', 'local_evidence', 'elyra_auth', 'PASS', null, 'v2.0'),
  ('29ee0000-0000-4000-8000-000000000002', 1, 'registry_format', 'local_evidence', 'elyra_format', 'PASS', repeat('b', 64), 'v2.0');

create function pg_temp.as_user(p_id text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end;
$$;

select ok(not has_function_privilege('anon', 'public.export_my_verification_evidence()', 'EXECUTE'), 'anon nao exporta');
select ok(not has_table_privilege('authenticated', 'public.professional_verification_evidence', 'SELECT'),
  'a tabela continua sem leitura direta');

select pg_temp.as_user('29ee0000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.export_my_verification_evidence()), 2, 'A recebe as duas evidencias dela');
select ok(
  (select bool_and(not (item ? 'value_digest')) from public.export_my_verification_evidence() item),
  'nenhuma linha leva o digest');
select ok(
  (select bool_and(item->>'professional_user_id' = '29ee0000-0000-4000-8000-000000000001') from public.export_my_verification_evidence() item),
  'so linhas da propria conta');
select throws_ok($$ select count(*) from public.professional_verification_evidence $$, '42501', null,
  'leitura direta segue recusada para o titular');

select pg_temp.as_user('29ee0000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.export_my_verification_evidence()), 1, 'B so ve a propria');

select * from finish();
rollback;
