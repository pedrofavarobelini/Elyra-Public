-- Era 3 - o acesso profissional, provado por comportamento e nao por forma.
--
-- **Por que este arquivo existe.** Os 15 arquivos pgTAP anteriores verificam
-- *forma*: que a policy existe, que a RPC existe, que o grant existe. Nenhum
-- verifica que uma permissao expirada **deixa de devolver linha**. A diferenca
-- nao e academica: `has_function('revoke_professional_connection')` continuaria
-- passando se o corpo da funcao fosse `select 1`.
--
-- A Definition of Done da Era 3 pede expiracao e revogacao provadas "por teste
-- de banco, nao apenas E2E" - e com razao. E2E prova o caminho da interface;
-- pgTAP prova a regra para quem chegar por qualquer caminho.
--
-- **Como o teste troca de identidade.** `professional_access_allowed` decide a
-- partir de `auth.uid()`, que le `request.jwt.claims`. O helper abaixo define a
-- claim e faz `set local role authenticated` **dentro** de uma funcao: um
-- superusuario ignora RLS, entao medir visibilidade sem trocar de papel mediria
-- o nada. `SET LOCAL` dentro da funcao reverte na saida, e cada cenario volta a
-- correr como `postgres` para montar o proximo.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(26);

-- ---------------------------------------------------------------------------
-- Fixtures. Montadas como superusuario de proposito: montar cenario e uma coisa,
-- medir visibilidade e outra.
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '90000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'era3-cliente@elyra.invalid', null,
   timezone('utc', now()), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Cliente Era3"}'::jsonb,
   timezone('utc', now()), timezone('utc', now())),
  ('00000000-0000-0000-0000-000000000000', '90000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'era3-profissional@elyra.invalid', null,
   timezone('utc', now()), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Profissional Era3"}'::jsonb,
   timezone('utc', now()), timezone('utc', now())),
  ('00000000-0000-0000-0000-000000000000', '90000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'era3-estranho@elyra.invalid', null,
   timezone('utc', now()), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Profissional sem vinculo"}'::jsonb,
   timezone('utc', now()), timezone('utc', now()));

insert into public.professional_profiles (user_id, registration_number, specialty)
values
  ('90000000-0000-4000-8000-000000000002', 'CRP-ERA3-01', 'Psicologia'),
  ('90000000-0000-4000-8000-000000000003', 'CRP-ERA3-02', 'Psicologia');

-- Stage 29 / PRO-1: o acesso profissional passou a exigir verificacao
-- vigente (G-01). A fixture representa um profissional ja revisado; o
-- portao em si e provado em `stage29_pro1_professional_verification.sql`.
update public.professional_profiles
set council_region = '06',
    verification_status = 'verified',
    verification_reviewed_at = timezone('utc', now()),
    verification_review_due_at = timezone('utc', now()) + interval '365 days'
where user_id in ('90000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000003');

insert into public.professional_connections (
  id, client_user_id, professional_user_id, invited_by_user_id, status, accepted_at
)
values (
  '90000000-0000-4000-8000-0000000000c1',
  '90000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000002',
  '90000000-0000-4000-8000-000000000001',
  'active', -- Stage 29 / PRO-3: 'accepted' passou a se chamar 'active'
  timezone('utc', now())
);

insert into public.emotional_checkins (id, user_id, occurred_at, mood_score)
values (
  '90000000-0000-4000-8000-0000000000e1',
  '90000000-0000-4000-8000-000000000001',
  timezone('utc', now()),
  7
);

insert into public.sleep_records (id, user_id, night, sleep_quality_score)
values (
  '90000000-0000-4000-8000-0000000000d1',
  '90000000-0000-4000-8000-000000000001',
  current_date,
  8
);

-- ---------------------------------------------------------------------------
-- O helper. Mede quantas linhas de um dominio um usuario **realmente** enxerga.
-- ---------------------------------------------------------------------------

create function pg_temp.visiveis_para(
  p_ator uuid,
  p_dono uuid,
  p_tabela text
)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_ator, 'role', 'authenticated')::text,
    true
  );
  -- Sem isto o teste mede um superusuario, que ignora RLS - ou seja, mede nada.
  set local role authenticated;

  if p_tabela = 'emotional_checkins' then
    select count(*) into n from public.emotional_checkins where user_id = p_dono;
  elsif p_tabela = 'sleep_records' then
    select count(*) into n from public.sleep_records where user_id = p_dono;
  elsif p_tabela = 'report_snapshots' then
    select count(*) into n from public.report_snapshots where user_id = p_dono;
  elsif p_tabela = 'professional_access_log' then
    select count(*) into n from public.professional_access_log
    where client_user_id = p_dono;
  else
    -- Fail closed tambem aqui: dominio nao previsto e erro, nao zero silencioso.
    raise exception 'dominio nao mapeado no helper: %', p_tabela;
  end if;

  reset role;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cenario 1 - permissao vigente
-- ---------------------------------------------------------------------------

insert into public.sharing_permissions (id, connection_id, scope, status)
values (
  '90000000-0000-4000-8000-0000000000f1',
  '90000000-0000-4000-8000-0000000000c1',
  'emotional',
  'granted'
);

select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001',
    'emotional_checkins'
  ),
  1,
  'permissao vigente: o profissional le o dominio concedido'
);

-- O escopo nao vaza para o vizinho: `emotional` concedido nao abre `sleep`.
select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001',
    'sleep_records'
  ),
  0,
  'escopo concedido nao abre o dominio vizinho'
);

-- Quem nao tem conexao nenhuma nao ve, mesmo existindo permissao para outro.
select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000003',
    '90000000-0000-4000-8000-000000000001',
    'emotional_checkins'
  ),
  0,
  'profissional sem conexao nao ve nada'
);

-- O dono continua vendo o proprio dado - a policy de profissional nao pode ter
-- estreitado o caminho de quem e titular.
select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',
    'emotional_checkins'
  ),
  1,
  'o titular continua vendo o proprio registro'
);

-- ---------------------------------------------------------------------------
-- Cenario 2 - permissao expirada
-- ---------------------------------------------------------------------------

update public.sharing_permissions
set expires_at = timezone('utc', now()) - interval '1 second'
where id = '90000000-0000-4000-8000-0000000000f1';

select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001',
    'emotional_checkins'
  ),
  0,
  'permissao expirada deixa de devolver linha'
);

-- Um segundo no futuro ainda vale: a fronteira e `>`, e o teste fixa isso em vez
-- de deixar a comparacao ambigua entre `>` e `>=`.
update public.sharing_permissions
set expires_at = timezone('utc', now()) + interval '1 hour'
where id = '90000000-0000-4000-8000-0000000000f1';

select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001',
    'emotional_checkins'
  ),
  1,
  'permissao ainda dentro do prazo continua valendo'
);

-- ---------------------------------------------------------------------------
-- Cenario 3 - permissao revogada
-- ---------------------------------------------------------------------------

update public.sharing_permissions
set status = 'revoked',
    revoked_at = timezone('utc', now()),
    expires_at = null
where id = '90000000-0000-4000-8000-0000000000f1';

select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001',
    'emotional_checkins'
  ),
  0,
  'permissao revogada deixa de devolver linha'
);

-- ---------------------------------------------------------------------------
-- Cenario 4 - conexao revogada com permissao ainda `granted`
--
-- Este e o cenario que mais importa: revogar a conexao precisa derrubar **todos**
-- os escopos de uma vez, mesmo os que ninguem lembrou de revogar um a um.
-- ---------------------------------------------------------------------------

update public.sharing_permissions
set status = 'granted', revoked_at = null
where id = '90000000-0000-4000-8000-0000000000f1';

insert into public.sharing_permissions (id, connection_id, scope, status)
values (
  '90000000-0000-4000-8000-0000000000f2',
  '90000000-0000-4000-8000-0000000000c1',
  'sleep',
  'granted'
);

select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001',
    'sleep_records'
  ),
  1,
  'antes da revogacao da conexao, os dois escopos valem'
);

update public.professional_connections
set status = 'revoked', revoked_at = timezone('utc', now())
where id = '90000000-0000-4000-8000-0000000000c1';

select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001',
    'emotional_checkins'
  ),
  0,
  'conexao revogada derruba o escopo emocional'
);

select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001',
    'sleep_records'
  ),
  0,
  'conexao revogada derruba tambem o escopo de sono, sem revogar permission'
);

-- ---------------------------------------------------------------------------
-- Cenario 5 - conexao ainda pendente
--
-- Convite enviado nao e convite aceito. Permissao criada antes do aceite nao
-- pode valer.
-- ---------------------------------------------------------------------------

update public.professional_connections
set status = 'pending', accepted_at = null, revoked_at = null
where id = '90000000-0000-4000-8000-0000000000c1';

select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001',
    'emotional_checkins'
  ),
  0,
  'conexao pendente nao concede leitura, mesmo com permission granted'
);

-- E o titular segue intacto em todos os cenarios acima.
select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',
    'sleep_records'
  ),
  1,
  'nada disso afetou o acesso do proprio titular'
);


-- ---------------------------------------------------------------------------
-- Cenario 6 - janela de tempo do dado
--
-- Ate aqui, `expires_at` provou expirar a **permissao**. Isto prova recortar o
-- **periodo do dado**: enquanto a permissao vale, o profissional so alcanca os
-- dias autorizados.
-- ---------------------------------------------------------------------------

-- Volta a conexao para aceita e mantem os dois escopos concedidos.
update public.professional_connections
set status = 'active', accepted_at = timezone('utc', now()), revoked_at = null
where id = '90000000-0000-4000-8000-0000000000c1';

-- Um check-in antigo, alem do de hoje ja inserido.
insert into public.emotional_checkins (id, user_id, occurred_at, mood_score)
values (
  '90000000-0000-4000-8000-0000000000e2',
  '90000000-0000-4000-8000-000000000001',
  timezone('utc', now()) - interval '400 days',
  4
);

select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001',
    'emotional_checkins'
  ),
  2,
  'sem janela declarada, o historico inteiro continua visivel'
);

-- Janela dos ultimos 30 dias: o registro de 400 dias atras sai.
update public.sharing_permissions
set data_from = current_date - 30, data_to = current_date
where id = '90000000-0000-4000-8000-0000000000f1';

select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001',
    'emotional_checkins'
  ),
  1,
  'janela de 30 dias recorta o historico: so o registro recente aparece'
);

-- Janela inteiramente no passado: nem o recente, nem o antigo.
update public.sharing_permissions
set data_from = current_date - 20, data_to = current_date - 10
where id = '90000000-0000-4000-8000-0000000000f1';

select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001',
    'emotional_checkins'
  ),
  0,
  'janela que nao contem nenhum registro devolve zero'
);

-- So limite inferior: pega tudo dali para frente.
update public.sharing_permissions
set data_from = current_date - 30, data_to = null
where id = '90000000-0000-4000-8000-0000000000f1';

select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001',
    'emotional_checkins'
  ),
  1,
  'somente data_from limita apenas o lado antigo'
);

-- So limite superior: pega tudo dali para tras.
update public.sharing_permissions
set data_from = null, data_to = current_date - 30
where id = '90000000-0000-4000-8000-0000000000f1';

select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001',
    'emotional_checkins'
  ),
  1,
  'somente data_to limita apenas o lado recente'
);

-- A janela de um escopo nao recorta o outro.
update public.sharing_permissions
set data_from = current_date - 20, data_to = current_date - 10
where id = '90000000-0000-4000-8000-0000000000f1';

select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001',
    'sleep_records'
  ),
  1,
  'janela e por permissao: recortar o emocional nao recorta o sono'
);

-- E o titular nunca e recortado pela janela que concedeu a outra pessoa.
select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',
    'emotional_checkins'
  ),
  2,
  'a janela nao alcanca o proprio titular'
);

-- ---------------------------------------------------------------------------
-- Cenario 7 - continencia, e nao sobreposicao
--
-- Um snapshot resume um intervalo. Mostra-lo por sobreposicao entregaria dias
-- fora da janela dentro de um numero agregado - que e exatamente o que a janela
-- existe para reter.
-- ---------------------------------------------------------------------------

insert into public.sharing_permissions (id, connection_id, scope, status, data_from, data_to)
values (
  '90000000-0000-4000-8000-0000000000f3',
  '90000000-0000-4000-8000-0000000000c1',
  'reports',
  'granted',
  current_date - 40,
  current_date
);

-- Snapshot de 28 dias, inteiramente dentro da janela.
insert into public.report_snapshots (
  id, user_id, time_zone, period_start, period_end, range_days, payload
)
values (
  '90000000-0000-4000-8000-0000000000a1',
  '90000000-0000-4000-8000-000000000001',
  'America/Sao_Paulo',
  current_date - 27,
  current_date,
  28,
  '{}'::jsonb
);

select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001',
    'report_snapshots'
  ),
  1,
  'snapshot inteiramente dentro da janela aparece'
);

-- Snapshot de 90 dias, que comeca antes da janela.
insert into public.report_snapshots (
  id, user_id, time_zone, period_start, period_end, range_days, payload
)
values (
  '90000000-0000-4000-8000-0000000000a2',
  '90000000-0000-4000-8000-000000000001',
  'America/Sao_Paulo',
  current_date - 89,
  current_date,
  90,
  '{}'::jsonb
);

select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001',
    'report_snapshots'
  ),
  1,
  'snapshot que comeca antes da janela nao aparece: continencia, nao sobreposicao'
);



-- ---------------------------------------------------------------------------
-- Cenario 8 - a trilha de acesso e do titular
--
-- `audit_logs` nao serve para isto: sua policy e `auth.uid() = actor_user_id`,
-- e num acesso profissional o ator e o profissional - o titular nunca leria.
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.professional_access_log'::regclass),
  'professional_access_log usa RLS forcada'
);

select ok(
  not has_table_privilege('anon', 'public.professional_access_log', 'SELECT'),
  'anon nao le a trilha de acesso'
);

select ok(
  not has_table_privilege('authenticated', 'public.professional_access_log', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.professional_access_log', 'DELETE'),
  'trilha de acesso e append-only para quem esta autenticado'
);

insert into public.professional_access_log (
  connection_id, client_user_id, professional_user_id, scope
)
values (
  '90000000-0000-4000-8000-0000000000c1',
  '90000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000002',
  'emotional'
);

select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',
    'professional_access_log'
  ),
  1,
  'o titular ve quem acessou o dado dele'
);

-- O profissional nao ganha tela para ver quem o auditou. A trilha existe para a
-- pessoa saber o que aconteceu com o dado dela, e nao para virar vigilancia em
-- qualquer direcao.
select is(
  pg_temp.visiveis_para(
    '90000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001',
    'professional_access_log'
  ),
  0,
  'o profissional nao le a trilha do titular, nem a propria atuacao'
);

select * from finish();
rollback;
