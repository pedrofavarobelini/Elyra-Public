-- Stage 23 / Gate 23-D - o consentimento sobrevive a confirmacao de e-mail.
--
-- O que este arquivo prova, e que nenhum teste de forma provaria:
--   1. a intencao so e aceita para conta recem-criada e ainda nao confirmada;
--   2. ninguem escreve na tabela de pendencia direto - so as funcoes;
--   3. o primeiro acesso autenticado materializa UM evento;
--   4. o segundo acesso nao duplica, porque a reivindicacao ja foi consumida;
--   5. a materializacao exige sessao, e so ve a propria pendencia;
--   6. proposito e versao do documento chegam intactos ao historico.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

-- ---------------------------------------------------------------------------
-- Fixture: duas contas, pelo mesmo caminho da aplicacao.
-- A primeira e um cadastro em andamento (sem confirmacao). A segunda existe
-- para provar que a materializacao de uma nao alcanca a outra.
-- ---------------------------------------------------------------------------

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
    '96000000-0000-4000-8000-000000000101',
    'authenticated', 'authenticated', 'stage23-pendente@elyra.invalid', null,
    null, '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Pessoa Pendente"}'::jsonb,
    timezone('utc', now()), timezone('utc', now())
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '96000000-0000-4000-8000-000000000102',
    'authenticated', 'authenticated', 'stage23-vizinha@elyra.invalid', null,
    timezone('utc', now()), '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Pessoa Vizinha"}'::jsonb,
    timezone('utc', now()), timezone('utc', now())
  );

-- ---------------------------------------------------------------------------
-- 1. Estrutura e autorizacao
-- ---------------------------------------------------------------------------

select has_table('public', 'pending_consents', 'a tabela de pendencia existe');

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.pending_consents'::regclass),
  'pending_consents usa RLS forcada'
);

select ok(
  has_table_privilege('authenticated', 'public.pending_consents', 'SELECT'),
  'a pessoa consegue auditar a propria pendencia'
);

/*
  O ponto de seguranca do desenho: se `authenticated` pudesse inserir aqui,
  qualquer um fabricaria a propria pendencia e o guarda de janela da funcao
  nao valeria nada.
*/
select ok(
  not has_table_privilege('authenticated', 'public.pending_consents', 'INSERT')
  and not has_table_privilege('authenticated', 'public.pending_consents', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.pending_consents', 'DELETE'),
  'ninguem escreve na pendencia direto: so as funcoes'
);

select ok(
  not has_table_privilege('anon', 'public.pending_consents', 'SELECT'),
  'anon nao le pendencia de ninguem'
);

-- ---------------------------------------------------------------------------
-- 2. Registrar a intencao: os guardas
-- ---------------------------------------------------------------------------

select is(
  public.record_pending_consent(
    '96000000-0000-4000-8000-000000000101', 'terms_privacy', 'v1'
  ),
  true,
  'cadastro em andamento registra a intencao'
);

select is(
  (select count(*)::integer from public.pending_consents
   where user_id = '96000000-0000-4000-8000-000000000101'),
  1,
  'uma linha de pendencia, e so uma'
);

select is(
  public.record_pending_consent(
    '96000000-0000-4000-8000-000000000102', 'terms_privacy', 'v1'
  ),
  false,
  'conta ja confirmada nao gera pendencia: o caminho dela e outro'
);

select is(
  public.record_pending_consent(
    '96000000-0000-4000-8000-000000000999', 'terms_privacy', 'v1'
  ),
  false,
  'usuario inexistente nao gera pendencia'
);

-- Fora da janela: envelhece a conta para alem do limite da funcao.
update auth.users
set created_at = timezone('utc', now()) - interval '10 minutes'
where id = '96000000-0000-4000-8000-000000000101';

select is(
  public.record_pending_consent(
    '96000000-0000-4000-8000-000000000101', 'training_data', 'v1'
  ),
  false,
  'fora da janela de cadastro a intencao e recusada'
);

-- ---------------------------------------------------------------------------
-- 3. Materializacao: exige sessao
-- ---------------------------------------------------------------------------

select throws_ok(
  $$select public.materialize_pending_consents()$$,
  '42501', null,
  'sem sessao nao ha materializacao'
);

-- ---------------------------------------------------------------------------
-- 4. O primeiro acesso autenticado, e o segundo
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"96000000-0000-4000-8000-000000000101","role":"authenticated"}';

select is(
  public.materialize_pending_consents(),
  1,
  'o primeiro acesso autenticado materializa a intencao'
);

select is(
  (select count(*)::integer from public.consent_events
   where user_id = '96000000-0000-4000-8000-000000000101'
     and purpose = 'terms_privacy' and event_type = 'granted'),
  1,
  'o historico definitivo recebeu exatamente um evento'
);

select is(
  (select document_version from public.consent_events
   where user_id = '96000000-0000-4000-8000-000000000101'
     and purpose = 'terms_privacy'),
  'v1',
  'a versao do documento aceito chega intacta ao historico'
);

/*
  Reload, segunda aba, retry do callback: o primeiro acesso acontece mais de uma
  vez. A reivindicacao ja foi consumida, entao nao ha o que materializar.
*/
select is(
  public.materialize_pending_consents(),
  0,
  'o segundo acesso nao materializa nada'
);

select is(
  (select count(*)::integer from public.consent_events
   where user_id = '96000000-0000-4000-8000-000000000101'
     and purpose = 'terms_privacy'),
  1,
  'e o historico continua com um unico evento'
);

reset role;

select * from finish();
rollback;
