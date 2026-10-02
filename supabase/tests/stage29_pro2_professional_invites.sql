-- Stage 29 / PRO-2 - convite seguro provado por comportamento.
--
-- Atores: P (profissional verificado), N (profissional nao verificado),
-- C e D (titulares), E (titular usado so para o limitador).
-- Tokens atravessam a troca de papel por GUC de transacao (`set_config(..., true)`).

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(51);

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
  ('29200000-0000-4000-8000-000000000001'::uuid, 'pro2-p@elyra.invalid', 'Profissional P'),
  ('29200000-0000-4000-8000-000000000002'::uuid, 'pro2-n@elyra.invalid', 'Profissional N'),
  ('29200000-0000-4000-8000-000000000003'::uuid, 'pro2-c@elyra.invalid', 'Titular C'),
  ('29200000-0000-4000-8000-000000000004'::uuid, 'pro2-d@elyra.invalid', 'Titular D'),
  ('29200000-0000-4000-8000-000000000005'::uuid, 'pro2-e@elyra.invalid', 'Titular E')
) as fixture(id, email, name);

insert into public.professional_profiles (
  user_id, council_region, registration_number, specialty, verification_status,
  verification_reviewed_at, verification_review_due_at
) values
  ('29200000-0000-4000-8000-000000000001', '06', '06/200001', 'Psicologia', 'verified',
   timezone('utc', now()), timezone('utc', now()) + interval '365 days'),
  ('29200000-0000-4000-8000-000000000002', '06', '06/200002', 'Psicologia', 'pending',
   null, null);

insert into public.emotional_checkins (id, user_id, occurred_at, mood_score)
values ('29200000-0000-4000-8000-0000000000e1', '29200000-0000-4000-8000-000000000003',
        now() - interval '1 minute', 5);

create function pg_temp.as_user(p_actor uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
$$;

-- ---------------------------------------------------------------------------
-- Forma
-- ---------------------------------------------------------------------------

select has_table('public', 'professional_invites', 'convites existem');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.professional_invites'::regclass), 'convites usam RLS forcada');
select ok(
  not has_table_privilege('anon', 'public.professional_invites', 'SELECT')
  and not has_table_privilege('authenticated', 'public.professional_invites', 'INSERT')
  and not has_table_privilege('authenticated', 'public.professional_invites', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.professional_invites', 'DELETE')
  and not has_table_privilege('service_role', 'public.professional_invites', 'UPDATE'),
  'convite so muda por RPC'
);
select ok(
  not exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'professional_invites'
                and column_name in ('token', 'raw_token', 'code', 'email')),
  'nenhuma coluna guarda token bruto ou e-mail'
);
select ok(exists (select 1 from pg_constraint where conname = 'professional_invites_digest_unique'), 'digest unico');
select ok(exists (select 1 from pg_constraint where conname = 'professional_invites_ttl'), 'TTL por constraint');
select ok(
  not has_function_privilege('authenticated', 'public.professional_invite_digest(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.professional_invite_resolve(uuid,text)', 'EXECUTE'),
  'resolucao interna nao e chamavel pelo cliente'
);
select ok(
  not has_function_privilege('anon', 'public.accept_professional_invite(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.preview_professional_invite(text)', 'EXECUTE'),
  'anon nao abre nem aceita convite'
);
select ok(
  has_function_privilege('service_role', 'public.purge_professional_invites()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.purge_professional_invites()', 'EXECUTE'),
  'purge e job operacional'
);

-- ---------------------------------------------------------------------------
-- Criacao
-- ---------------------------------------------------------------------------

select pg_temp.as_user('29200000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok($$select * from public.create_professional_invite()$$, '42501', null,
  'profissional nao verificado nao convida');
reset role;

select pg_temp.as_user('29200000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok($$select * from public.create_professional_invite()$$, '42501', null,
  'quem nao e profissional nao convida');
reset role;

select pg_temp.as_user('29200000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('pro2.t1', (select token from public.create_professional_invite()), true);
select set_config('pro2.t2', (select token from public.create_professional_invite()), true);
select set_config('pro2.t3', (select token from public.create_professional_invite()), true);
select set_config('pro2.t4', (select token from public.create_professional_invite()), true);
select set_config('pro2.t5', (select token from public.create_professional_invite()), true);
select ok(current_setting('pro2.t1') ~ '^ELY-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$', 'codigo curto Crockford (L-432)');
select isnt(current_setting('pro2.t1'), current_setting('pro2.t2'), 'tokens distintos');
select is((select count(*)::integer from public.list_my_professional_invites()), 5, 'profissional lista os proprios convites');
select ok(
  not exists (select 1 from pg_proc where proname = 'list_my_professional_invites'
              and 'token_digest' = any(proargnames)),
  'listagem nao devolve digest'
);
reset role;

select is(
  (select count(*)::integer from public.professional_invites
   where token_digest = extensions.digest(convert_to(current_setting('pro2.t1'), 'UTF8'), 'sha256')),
  1,
  'persistido so o sha256 do token'
);
select ok(
  not exists (select 1 from public.professional_invites invite
              where invite::text like '%' || current_setting('pro2.t1') || '%')
  and not exists (select 1 from public.audit_logs log
                  where log::text like '%' || current_setting('pro2.t1') || '%'),
  'token bruto nao aparece em nenhuma linha de convite nem de audit'
);
select ok(
  (select bool_and(expires_at between created_at + interval '71 hours 59 minutes'
                                  and created_at + interval '72 hours 1 minute')
   from public.professional_invites where professional_user_id = '29200000-0000-4000-8000-000000000001'),
  'TTL de 72 horas'
);
select throws_ok(
  $$update public.professional_invites set expires_at = created_at + interval '30 days'
    where professional_user_id = '29200000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'TTL acima de 7 dias e recusado ate pelo dono do schema'
);

-- ---------------------------------------------------------------------------
-- Preview e aceite
-- ---------------------------------------------------------------------------

select pg_temp.as_user('29200000-0000-4000-8000-000000000001');
set local role authenticated;
select is((select count(*)::integer from public.preview_professional_invite(current_setting('pro2.t1'))), 0,
  'profissional nao abre o proprio convite');
reset role;

select pg_temp.as_user('29200000-0000-4000-8000-000000000003');
set local role authenticated;
select is((select count(*)::integer from public.preview_professional_invite('x' || substr(current_setting('pro2.t1'), 2))), 0,
  'token errado devolve vazio');
select is((select count(*)::integer from public.preview_professional_invite('nao-e-token')), 0,
  'token malformado devolve vazio');
select is((select count(*)::integer from public.professional_invites), 0,
  'titular nao le a tabela de convites');
select is(
  (select professional_display_name || '|' || council_region || '|' || registration_number
   from public.preview_professional_invite(current_setting('pro2.t1'))),
  'Profissional P|06|06/200001',
  'preview mostra somente fatos do profissional'
);
select set_config('pro2.rel', public.accept_professional_invite(current_setting('pro2.t1'))::text, true);
select ok(current_setting('pro2.rel') <> '', 'titular aceita o convite');
select is((select status from public.professional_connections where id = current_setting('pro2.rel')::uuid), 'active', -- PRO-3: vocabulario de relationship
  'aceite ativa a relationship');
select is((select count(*)::integer from public.sharing_permissions where connection_id = current_setting('pro2.rel')::uuid), 0,
  'aceitar convite nao cria grant');
select is(public.accept_professional_invite(current_setting('pro2.t1')), current_setting('pro2.rel')::uuid,
  'L-435: replay pelo proprio titular e idempotente (mesmo vinculo, nada novo)');
select is(public.decline_professional_invite(current_setting('pro2.t1')), false,
  'token aceito nao pode ser recusado depois');
reset role;

select is(
  (select state || ':' || (consumed_at is not null)::text || ':' || redeemed_by_user_id::text
   from public.professional_invites
   where token_digest = extensions.digest(convert_to(current_setting('pro2.t1'), 'UTF8'), 'sha256')),
  'accepted:true:29200000-0000-4000-8000-000000000003',
  'convite aceito fica consumido e ligado ao titular'
);
select is(
  (select origin_invite_id is not null and invited_by_user_id = '29200000-0000-4000-8000-000000000001'
   from public.professional_connections where id = current_setting('pro2.rel')::uuid),
  true,
  'relationship guarda a origem no convite do profissional'
);

-- Aceitar nao concede dado: sem grant o profissional nao le nada.
select pg_temp.as_user('29200000-0000-4000-8000-000000000001');
set local role authenticated;
select is((select count(*)::integer from public.emotional_checkins
           where user_id = '29200000-0000-4000-8000-000000000003'), 0,
  'relationship ativa sem grant nao le dado');
reset role;

select pg_temp.as_user('29200000-0000-4000-8000-000000000004');
set local role authenticated;
select is(public.accept_professional_invite(current_setting('pro2.t1')), null,
  'outro titular nao reutiliza token consumido');
reset role;

-- Revogado.
select pg_temp.as_user('29200000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok(
  $$select public.revoke_professional_invite((select id from public.professional_invites
    where token_digest = extensions.digest(convert_to(current_setting('pro2.t2'), 'UTF8'), 'sha256')))$$,
  'profissional revoga convite vivo'
);
select throws_ok(
  $$select public.revoke_professional_invite((select id from public.professional_invites
    where token_digest = extensions.digest(convert_to(current_setting('pro2.t1'), 'UTF8'), 'sha256')))$$,
  '22023', null,
  'convite ja aceito nao e revogavel'
);
reset role;

select pg_temp.as_user('29200000-0000-4000-8000-000000000004');
set local role authenticated;
select is(public.accept_professional_invite(current_setting('pro2.t2')), null, 'convite revogado nao e aceito');
select throws_ok(
  $$select public.revoke_professional_invite('29200000-0000-4000-8000-0000000000aa')$$,
  '42501', null,
  'terceiro nao revoga convite alheio'
);
reset role;

-- Expirado: materializado na tentativa e nunca revertido.
update public.professional_invites
set created_at = timezone('utc', now()) - interval '80 hours',
    expires_at = timezone('utc', now()) - interval '8 hours'
where token_digest = extensions.digest(convert_to(current_setting('pro2.t3'), 'UTF8'), 'sha256');

select pg_temp.as_user('29200000-0000-4000-8000-000000000004');
set local role authenticated;
select is(public.accept_professional_invite(current_setting('pro2.t3')), null, 'convite expirado nao e aceito');
reset role;
select is(
  (select state from public.professional_invites
   where token_digest = extensions.digest(convert_to(current_setting('pro2.t3'), 'UTF8'), 'sha256')),
  'expired',
  'expiracao fica materializada'
);

-- Recusa consome o token sem criar vinculo.
select pg_temp.as_user('29200000-0000-4000-8000-000000000004');
set local role authenticated;
select is(public.decline_professional_invite(current_setting('pro2.t4')), true, 'titular recusa');
select is(public.accept_professional_invite(current_setting('pro2.t4')), null, 'token recusado nao aceita depois');
reset role;
select is(
  (select count(*)::integer from public.professional_connections
   where client_user_id = '29200000-0000-4000-8000-000000000004'),
  0,
  'recusa nao cria relationship'
);

-- Profissional que perde a verificacao depois de convidar.
update public.professional_profiles set verification_status = 'suspended'
where user_id = '29200000-0000-4000-8000-000000000001';
select pg_temp.as_user('29200000-0000-4000-8000-000000000004');
set local role authenticated;
select is(public.accept_professional_invite(current_setting('pro2.t5')), null,
  'convite de profissional suspenso nao ativa vinculo');
reset role;
update public.professional_profiles set verification_status = 'verified'
where user_id = '29200000-0000-4000-8000-000000000001';

-- Reativacao nunca ressuscita grant.
insert into public.sharing_permissions (connection_id, scope)
values (current_setting('pro2.rel')::uuid, 'emotional');
select pg_temp.as_user('29200000-0000-4000-8000-000000000003');
set local role authenticated;
select lives_ok($$select public.revoke_professional_connection(current_setting('pro2.rel')::uuid)$$,
  'titular revoga a relationship');
reset role;
select pg_temp.as_user('29200000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('pro2.t6', (select token from public.create_professional_invite()), true);
reset role;
select pg_temp.as_user('29200000-0000-4000-8000-000000000003');
set local role authenticated;
select is(public.accept_professional_invite(current_setting('pro2.t6')), current_setting('pro2.rel')::uuid,
  'novo convite reativa a mesma relationship');
reset role;
select is(
  (select string_agg(status, ',') from public.sharing_permissions
   where connection_id = current_setting('pro2.rel')::uuid),
  'revoked',
  'grant anterior continua revogado depois da reativacao'
);
select pg_temp.as_user('29200000-0000-4000-8000-000000000001');
set local role authenticated;
select is((select count(*)::integer from public.emotional_checkins
           where user_id = '29200000-0000-4000-8000-000000000003'), 0,
  'reativado sem novo grant nao le');
reset role;

-- Limitador no banco: 10 tentativas recusadas em 10 minutos bloqueiam a 11a.
select pg_temp.as_user('29200000-0000-4000-8000-000000000005');
set local role authenticated;
select is(
  (select count(*)::integer from generate_series(1, 10) attempt,
     lateral public.preview_professional_invite(repeat('A', 42) || attempt % 10) preview),
  0,
  'dez tentativas erradas devolvem vazio'
);
select throws_ok(
  $$select * from public.preview_professional_invite(current_setting('pro2.t6'))$$,
  '54000', null,
  'a decima primeira tentativa e bloqueada mesmo com token valido'
);
reset role;
select is(
  (select count(*)::integer from public.audit_logs
   where actor_user_id = '29200000-0000-4000-8000-000000000005'
     and action = 'professional_invite.redeem_denied' and outcome = 'denied'),
  10,
  'cada tentativa recusada fica registrada sem token'
);

-- Purge operacional.
update public.professional_invites
set created_at = timezone('utc', now()) - interval '40 days',
    expires_at = timezone('utc', now()) - interval '37 days',
    expired_at = timezone('utc', now()) - interval '37 days'
where token_digest = extensions.digest(convert_to(current_setting('pro2.t3'), 'UTF8'), 'sha256');
select is(public.purge_professional_invites(), 1, 'purge apaga so o terminal antigo');

select * from finish();
rollback;
