begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(8);

-- Fixtures como superusuario; cada chamada da RPC roda como o titular (RLS real).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '95000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 's25-titular@elyra.invalid', null,
   timezone('utc', now()), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Titular S25"}'::jsonb,
   timezone('utc', now()), timezone('utc', now())),
  ('00000000-0000-0000-0000-000000000000', '95000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 's25-outro@elyra.invalid', null,
   timezone('utc', now()), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Outro S25"}'::jsonb,
   timezone('utc', now()), timezone('utc', now()));

create function pg_temp.criar_como(p_ator uuid, p_payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  result jsonb;
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_ator, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
  result := public.create_emotional_checkin_v3(p_payload);
  reset role;
  return result;
end;
$$;

select has_function('public', 'create_emotional_checkin_v3', array['jsonb'], 'RPC v3 existe');
select has_function('public', 'create_emotional_checkin_v2', array['jsonb'], 'RPC v2 preservada');

-- 1. Primeira criacao com ID do aparelho.
select is(
  (pg_temp.criar_como(
    '95000000-0000-4000-8000-000000000001',
    '{"id":"95100000-0000-4000-8000-000000000001","mood_score":7,"occurred_at":"2026-09-16T10:00:00Z","factor_ids":[]}'
  ) ->> 'replayed')::boolean,
  false,
  'primeira criacao grava'
);

-- 2. Reenvio identico (ACK perdido): devolve o existente, nao duplica.
select is(
  (pg_temp.criar_como(
    '95000000-0000-4000-8000-000000000001',
    '{"id":"95100000-0000-4000-8000-000000000001","mood_score":7,"occurred_at":"2026-09-16T10:00:00Z","factor_ids":[]}'
  ) ->> 'replayed')::boolean,
  true,
  'reenvio do mesmo ID e reconhecido'
);
select is(
  (select count(*)::integer from public.emotional_checkins where id = '95100000-0000-4000-8000-000000000001'),
  1,
  'reenvio nao cria segunda linha'
);
select is(
  (select occurred_at from public.emotional_checkins where id = '95100000-0000-4000-8000-000000000001'),
  '2026-09-16T10:00:00Z'::timestamptz,
  'horario do aparelho preservado'
);

-- 3. Mesmo ID usado por outra pessoa: nao ve o registro e nao sobrescreve.
select throws_ok(
  $$select pg_temp.criar_como(
    '95000000-0000-4000-8000-000000000002',
    '{"id":"95100000-0000-4000-8000-000000000001","mood_score":2,"factor_ids":[]}'
  )$$,
  '23505',
  null,
  'ID de outro titular colide e falha, sem vazar nem sobrescrever'
);

-- 4. Sem ID continua funcionando como a v2.
select ok(
  (pg_temp.criar_como(
    '95000000-0000-4000-8000-000000000001',
    '{"energy_score":5,"factor_ids":[]}'
  ) ->> 'id') is not null,
  'sem ID gera ID no servidor'
);

select * from finish();
rollback;
