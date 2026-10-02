-- Stage 29 — codigo curto de convite (L-432), aceite idempotente (L-435),
-- aviso ao profissional (L-433), legado fechado (L-434). Provado por
-- comportamento, com os mesmos atores do PRO-2 em outro espaco de UUID.
--
-- P: profissional verificado (perfil publico listado) · N: nao verificado
-- C, D, E, F, G: titulares.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(54);

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
  ('29300000-0000-4000-8000-000000000001'::uuid, 'ic-p@elyra.invalid', 'Profissional P'),
  ('29300000-0000-4000-8000-000000000002'::uuid, 'ic-n@elyra.invalid', 'Profissional N'),
  ('29300000-0000-4000-8000-000000000003'::uuid, 'ic-c@elyra.invalid', 'Titular C'),
  ('29300000-0000-4000-8000-000000000004'::uuid, 'ic-d@elyra.invalid', 'Titular D'),
  ('29300000-0000-4000-8000-000000000005'::uuid, 'ic-e@elyra.invalid', 'Titular E'),
  ('29300000-0000-4000-8000-000000000006'::uuid, 'ic-f@elyra.invalid', 'Titular F'),
  ('29300000-0000-4000-8000-000000000007'::uuid, 'ic-g@elyra.invalid', 'Titular G')
) as fixture(id, email, name);

insert into public.professional_profiles (
  user_id, council_region, registration_number, specialty, verification_status,
  verification_reviewed_at, verification_review_due_at
) values
  ('29300000-0000-4000-8000-000000000001', '06', '06/300001', 'Psicologia', 'verified',
   timezone('utc', now()), timezone('utc', now()) + interval '365 days'),
  ('29300000-0000-4000-8000-000000000002', '06', '06/300002', 'Psicologia', 'pending', null, null);

insert into public.professional_public_profiles (user_id, listed, display_name, city, state, modalities, areas, languages)
values ('29300000-0000-4000-8000-000000000001', true, 'Helena Convite', 'Orlandia', 'SP',
        array['online'], array['ansiedade'], array['pt']);

create function pg_temp.as_user(p_actor uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.new_code()
returns text
language sql
as $$
  select token from public.create_professional_invite();
$$;

-- ---------------------------------------------------------------------------
-- Superficie
-- ---------------------------------------------------------------------------

select has_function('public', 'accept_professional_invite_code', array['text'], 'aceite com resultado existe');
select ok(
  has_function_privilege('authenticated', 'public.accept_professional_invite_code(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.accept_professional_invite_code(text)', 'EXECUTE'),
  'aceite so para autenticado'
);
select ok(
  not has_function_privilege('authenticated', 'public.professional_invite_lookup_digest(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.professional_invite_new_code()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.professional_invite_attempts_exceeded(uuid)', 'EXECUTE'),
  'normalizacao, geracao e limitador sao internos'
);
select ok(
  not has_function_privilege('authenticated', 'public.invite_professional(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.invite_professional(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.invite_professional(uuid)', 'EXECUTE'),
  'L-434: legado por UUID sem EXECUTE'
);
select has_function('public', 'invite_professional', array['uuid'], 'legado preservado sem drop');

-- ---------------------------------------------------------------------------
-- Normalizacao (mesma regra do contrato TS)
-- ---------------------------------------------------------------------------

select is(public.professional_invite_lookup_digest('ely-8k4m2-9qxz1'),
          extensions.digest(convert_to('ELY-8K4M2-9QXZ1', 'UTF8'), 'sha256'), 'caixa baixa');
select is(public.professional_invite_lookup_digest('  ELY8K4M29QXZ1 '),
          extensions.digest(convert_to('ELY-8K4M2-9QXZ1', 'UTF8'), 'sha256'), 'sem hifen, espacos nas pontas');
select is(public.professional_invite_lookup_digest('8K4M2 9QXZ1'),
          extensions.digest(convert_to('ELY-8K4M2-9QXZ1', 'UTF8'), 'sha256'), 'sem prefixo, espaco como separador');
select is(public.professional_invite_lookup_digest('ELY-O0IL1-AAAAA'),
          extensions.digest(convert_to('ELY-00111-AAAAA', 'UTF8'), 'sha256'), 'O/I/L lidos como 0/1/1');
select is(public.professional_invite_lookup_digest('ELY-8K4M2-9QXZU'), null, 'U invalida');
select is(public.professional_invite_lookup_digest('XLY-8K4M2-9QXZ1'), null, 'prefixo errado invalida');
select is(public.professional_invite_lookup_digest('ELY-8K4M2-9QXZ'), null, 'curto invalida');
select is(public.professional_invite_lookup_digest(repeat('A', 42) || 'b'),
          extensions.digest(convert_to(repeat('A', 42) || 'b', 'UTF8'), 'sha256'),
          'transicao: token longo e digerido byte a byte (caixa preservada)');
select ok(
  (select bool_and(public.professional_invite_new_code() ~ '^ELY-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$')
   from generate_series(1, 200)),
  'geracao sempre no formato canonico'
);
select is((select count(distinct public.professional_invite_new_code())::integer from generate_series(1, 500)), 500,
  '500 codigos gerados, nenhum repetido');

-- ---------------------------------------------------------------------------
-- Criacao
-- ---------------------------------------------------------------------------

select pg_temp.as_user('29300000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok($$select pg_temp.new_code()$$, '42501', null, 'nao verificado nao gera codigo');
reset role;

select pg_temp.as_user('29300000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('ic.c1', pg_temp.new_code(), true);
select set_config('ic.c2', pg_temp.new_code(), true);
select set_config('ic.c3', pg_temp.new_code(), true);
select set_config('ic.c4', pg_temp.new_code(), true);
select set_config('ic.c5', pg_temp.new_code(), true);
select set_config('ic.c6', pg_temp.new_code(), true);
reset role;

select ok(current_setting('ic.c1') ~ '^ELY-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$', 'codigo curto devolvido uma vez');
select is(
  (select policy_version from public.professional_invites
   where token_digest = extensions.digest(convert_to(current_setting('ic.c1'), 'UTF8'), 'sha256')),
  'stage29.invite.short.v1',
  'persistido so o sha256 da forma canonica'
);
select ok(
  (select bool_and(expires_at between created_at + interval '71 hours 59 minutes'
                                  and created_at + interval '72 hours 1 minute')
   from public.professional_invites where professional_user_id = '29300000-0000-4000-8000-000000000001'),
  'TTL de 72 horas preservado'
);

-- ---------------------------------------------------------------------------
-- Preview e aceite com a entrada "baguncada"
-- ---------------------------------------------------------------------------

select pg_temp.as_user('29300000-0000-4000-8000-000000000003');
set local role authenticated;
select is(
  (select professional_display_name from public.preview_professional_invite(
     lower(replace(current_setting('ic.c1'), '-', ' ')))),
  'Helena Convite',
  'preview aceita caixa baixa e espacos e mostra o mesmo nome publico do aceite'
);
create temp table accepted_c1 as
select * from public.accept_professional_invite_code(lower(replace(current_setting('ic.c1'), '-', '')));
reset role;

select is((select outcome || ':' || connection_status from accepted_c1), 'created:active', 'aceite cria vinculo ativo');
select is((select professional_display_name || ':' || (professional_slug is not null)::text from accepted_c1), 'Helena Convite:true',
  'aceite devolve nome publico e slug do perfil listado');
select set_config('ic.rel', (select connection_id::text from accepted_c1), true);
select is((select count(*)::integer from public.sharing_permissions where connection_id = current_setting('ic.rel')::uuid), 0,
  'ZERO GRANTS depois do aceite');
select is(
  (select count(*)::integer from public.notifications
   where user_id = '29300000-0000-4000-8000-000000000001' and kind = 'invite_accepted'),
  1,
  'L-433: profissional recebe um aviso'
);
select ok(
  not exists (select 1 from public.notifications n where n::text ilike '%' || right(current_setting('ic.c1'), 11) || '%')
  and not exists (select 1 from public.audit_logs l where l::text ilike '%' || right(current_setting('ic.c1'), 11) || '%')
  and not exists (select 1 from public.professional_invites i where i::text ilike '%' || right(current_setting('ic.c1'), 11) || '%'),
  'codigo nao aparece em aviso, audit nem convite'
);

-- Profissional nao le dado nenhum so por estar vinculado.
insert into public.emotional_checkins (id, user_id, occurred_at, mood_score)
values ('29300000-0000-4000-8000-0000000000e1', '29300000-0000-4000-8000-000000000003', timezone('utc', now()), 5);
select pg_temp.as_user('29300000-0000-4000-8000-000000000001');
set local role authenticated;
select is((select count(*)::integer from public.emotional_checkins where user_id = '29300000-0000-4000-8000-000000000003'), 0,
  'vinculo ativo sem grant nao le humor');
reset role;

-- ---------------------------------------------------------------------------
-- Idempotencia so para o proprio titular (L-435)
-- ---------------------------------------------------------------------------

select pg_temp.as_user('29300000-0000-4000-8000-000000000003');
set local role authenticated;
select is(
  (select outcome || ':' || connection_id::text from public.accept_professional_invite_code(current_setting('ic.c1'))),
  'already_accepted:' || current_setting('ic.rel'),
  'repetir o aceite devolve o mesmo vinculo'
);
reset role;
select is(
  (select count(*)::integer from public.notifications
   where user_id = '29300000-0000-4000-8000-000000000001' and kind = 'invite_accepted'),
  1,
  'repeticao nao duplica o aviso'
);
select is(
  (select count(*)::integer from public.audit_logs
   where actor_user_id = '29300000-0000-4000-8000-000000000003' and action = 'professional_invite.redeem_denied'),
  0,
  'repeticao do proprio titular nao conta como tentativa negada'
);
select pg_temp.as_user('29300000-0000-4000-8000-000000000003');
set local role authenticated;
select is(public.decline_professional_invite(current_setting('ic.c1')), false, 'aceito nao vira recusa');
reset role;

select pg_temp.as_user('29300000-0000-4000-8000-000000000004');
set local role authenticated;
select is((select count(*)::integer from public.accept_professional_invite_code(current_setting('ic.c1'))), 0,
  'outra pessoa nao reusa o codigo (vazio, como invalido)');
select is((select count(*)::integer from public.accept_professional_invite_code('ELY-00000-00000')), 0,
  'codigo inexistente: mesmo vazio');
reset role;
select is(
  (select count(*)::integer from public.audit_logs
   where actor_user_id = '29300000-0000-4000-8000-000000000004' and action = 'professional_invite.redeem_denied'),
  2,
  'as duas tentativas de D ficam registradas como negadas'
);

-- ---------------------------------------------------------------------------
-- Vinculo ja ativo, pausado, reativado
-- ---------------------------------------------------------------------------

select pg_temp.as_user('29300000-0000-4000-8000-000000000003');
set local role authenticated;
select is((select outcome from public.accept_professional_invite_code(current_setting('ic.c2'))), 'already_active',
  'segundo convite com vinculo ativo: nada muda');
select lives_ok($$select public.pause_professional_relationship(current_setting('ic.rel')::uuid)$$, 'titular pausa');
select is(
  (select outcome || ':' || connection_status from public.accept_professional_invite_code(current_setting('ic.c3'))),
  'already_paused:paused',
  'aceitar nunca retoma pausa em silencio'
);
reset role;

insert into public.sharing_permissions (connection_id, scope) values (current_setting('ic.rel')::uuid, 'emotional');
select pg_temp.as_user('29300000-0000-4000-8000-000000000003');
set local role authenticated;
select lives_ok($$select public.revoke_professional_connection(current_setting('ic.rel')::uuid)$$, 'titular encerra');
select is((select outcome from public.accept_professional_invite_code(current_setting('ic.c4'))), 'activated',
  'novo convite reativa o mesmo vinculo');
reset role;
select is(
  (select count(*)::integer from public.sharing_permissions
   where connection_id = current_setting('ic.rel')::uuid and status = 'granted'),
  0,
  'ZERO GRANTS vigentes depois da reativacao'
);

-- ---------------------------------------------------------------------------
-- Estados terminais e verificacao
-- ---------------------------------------------------------------------------

select pg_temp.as_user('29300000-0000-4000-8000-000000000001');
set local role authenticated;
select is((select count(*)::integer from public.accept_professional_invite_code(current_setting('ic.c5'))), 0,
  'profissional nao aceita o proprio codigo');
select lives_ok(
  $$select public.revoke_professional_invite((select id from public.professional_invites
    where token_digest = extensions.digest(convert_to(current_setting('ic.c5'), 'UTF8'), 'sha256')))$$,
  'profissional cancela o codigo'
);
reset role;
select pg_temp.as_user('29300000-0000-4000-8000-000000000004');
set local role authenticated;
select is((select count(*)::integer from public.accept_professional_invite_code(current_setting('ic.c5'))), 0,
  'codigo cancelado: vazio');
reset role;

update public.professional_invites
set created_at = timezone('utc', now()) - interval '80 hours',
    expires_at = timezone('utc', now()) - interval '8 hours'
where token_digest = extensions.digest(convert_to(current_setting('ic.c6'), 'UTF8'), 'sha256');
select pg_temp.as_user('29300000-0000-4000-8000-000000000004');
set local role authenticated;
select is((select count(*)::integer from public.accept_professional_invite_code(current_setting('ic.c6'))), 0,
  'codigo expirado: vazio');
reset role;
select is(
  (select state from public.professional_invites
   where token_digest = extensions.digest(convert_to(current_setting('ic.c6'), 'UTF8'), 'sha256')),
  'expired', 'expiracao materializada');

-- Transicao: convite longo do PRO-2 ainda vivo continua aceitavel.
insert into public.professional_invites (professional_user_id, token_digest, expires_at)
values ('29300000-0000-4000-8000-000000000001',
        extensions.digest(convert_to(repeat('Q', 40) || 'x_-', 'UTF8'), 'sha256'),
        timezone('utc', now()) + interval '10 hours');
select pg_temp.as_user('29300000-0000-4000-8000-000000000004');
set local role authenticated;
select is((select outcome from public.accept_professional_invite_code(repeat('Q', 40) || 'x_-')), 'created',
  'transicao: token longo vivo ainda cria o vinculo');
reset role;
select is(
  (select count(*)::integer from public.sharing_permissions sp
   join public.professional_connections c on c.id = sp.connection_id
   where c.client_user_id = '29300000-0000-4000-8000-000000000004'),
  0,
  'ZERO GRANTS tambem pelo caminho de transicao'
);

-- Profissional que perde a verificacao: codigo vivo deixa de abrir.
select pg_temp.as_user('29300000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('ic.c7', pg_temp.new_code(), true);
reset role;
update public.professional_profiles set verification_status = 'suspended'
where user_id = '29300000-0000-4000-8000-000000000001';
select pg_temp.as_user('29300000-0000-4000-8000-000000000005');
set local role authenticated;
select is((select count(*)::integer from public.accept_professional_invite_code(current_setting('ic.c7'))), 0,
  'profissional suspenso: vazio');
reset role;
update public.professional_profiles set verification_status = 'verified'
where user_id = '29300000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- Limitador: por conta e modo de ataque distribuido
-- ---------------------------------------------------------------------------

-- E ja tem 1 negativa (suspenso). Mais 9 = 10 -> bloqueado mesmo com codigo valido.
select pg_temp.as_user('29300000-0000-4000-8000-000000000005');
set local role authenticated;
select is((select count(*)::integer from generate_series(1, 9) attempt,
             lateral public.preview_professional_invite('ELY-00000-0000' || attempt) preview), 0,
  'nove tentativas erradas devolvem vazio');
select throws_ok($$select * from public.preview_professional_invite(current_setting('ic.c7'))$$, '54000', null,
  'por conta: a 11a tentativa e bloqueada mesmo com codigo valido');
reset role;

-- Ataque distribuido: 200 negativas no banco em 10 min.
select public.professional_invite_record_denied('29300000-0000-4000-8000-000000000005') from generate_series(1, 200);

select pg_temp.as_user('29300000-0000-4000-8000-000000000007');
set local role authenticated;
select is((select count(*)::integer from public.preview_professional_invite(current_setting('ic.c7'))), 1,
  'sob ataque, quem digita o codigo certo nao e bloqueado (sem DoS)');
reset role;

select pg_temp.as_user('29300000-0000-4000-8000-000000000006');
set local role authenticated;
select is((select count(*)::integer from generate_series(1, 3) attempt,
             lateral public.preview_professional_invite('ELY-11111-1111' || attempt) preview), 0,
  'tres erros sob ataque');
select throws_ok($$select * from public.preview_professional_invite(current_setting('ic.c7'))$$, '54000', null,
  'sob ataque, o teto por conta cai para 3');
reset role;

-- ---------------------------------------------------------------------------
-- Legado por UUID (L-434)
-- ---------------------------------------------------------------------------

select pg_temp.as_user('29300000-0000-4000-8000-000000000007');
set local role authenticated;
select throws_ok($$select public.invite_professional('29300000-0000-4000-8000-000000000001')$$, '42501', null,
  'caminho legado nao cria mais vinculo');
reset role;
select is((select count(*)::integer from public.professional_connections
           where client_user_id = '29300000-0000-4000-8000-000000000007'), 0,
  'nenhum vinculo criado pelo legado');

select * from finish();
rollback;
