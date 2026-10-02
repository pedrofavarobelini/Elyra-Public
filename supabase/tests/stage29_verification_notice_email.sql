-- Stage 29 / Pre-closure - L-323: o interruptor de e-mail de "Cadastro
-- profissional" agora tem caminho de entrega (dispatcher), e so ele.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(10);

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
  ('29e60000-0000-4000-8000-000000000001'::uuid, 'l323-a@elyra.invalid', 'Pro Email'),
  ('29e60000-0000-4000-8000-000000000002'::uuid, 'l323-b@elyra.invalid', 'Pro Sem Email'),
  ('29e60000-0000-4000-8000-000000000003'::uuid, 'l323-c@elyra.invalid', 'Pro So Email')
) as fixture(id, email, name);

select public.seed_notification_preferences(id) from auth.users where email like 'l323-%';

-- A: e-mail ligado (in-app padrao ligado). B: so padrao (e-mail desligado).
-- C: in-app DESLIGADO e e-mail ligado: o e-mail nao pode depender do in-app.
update public.notification_preferences set enabled = true
where kind = 'professional_verification_update' and channel = 'email'
  and user_id in ('29e60000-0000-4000-8000-000000000001', '29e60000-0000-4000-8000-000000000003');
update public.notification_preferences set enabled = false
where kind = 'professional_verification_update' and channel = 'in_app'
  and user_id = '29e60000-0000-4000-8000-000000000003';

select public.professional_verification_notify(id) from auth.users where email like 'l323-%';

select is(
  (select count(*)::int from public.audit_logs
    where action = 'professional_verification.notice_created'
      and entity_id in (select id from auth.users where email like 'l323-%')),
  3, 'cada evento grava uma linha de auditoria, independente de canal');
select is(
  (select count(*)::int from public.audit_logs
    where action = 'professional_verification.notice_created'
      and entity_id in (select id from auth.users where email like 'l323-%')
      and actor_user_id is null and entity_type = 'professional_profile' and outcome = 'success'),
  3, 'a linha nao tem ator nem conteudo: so o fato');

create temporary table due on commit drop as
  select * from public.due_notification_emails('America/Sao_Paulo', 500)
  where kind = 'professional_verification_update';

select is((select count(*)::int from due where user_id = '29e60000-0000-4000-8000-000000000001'), 1,
  'e-mail ligado: o dispatcher enxerga o aviso de cadastro');
select is((select count(*)::int from due where user_id = '29e60000-0000-4000-8000-000000000002'), 0,
  'e-mail desligado: nada sai');
select is((select count(*)::int from due where user_id = '29e60000-0000-4000-8000-000000000003'), 1,
  'in-app desligado nao impede o e-mail escolhido');
select ok(
  (select bool_and(event_key ~ '^professional_verification_update:[0-9a-f-]{36}$') from due),
  'chave de evento no formato aceito por email_deliveries');

select is(
  (select count(*)::int from public.notifications
    where kind = 'professional_verification_update'
      and user_id = '29e60000-0000-4000-8000-000000000003'),
  0, 'in-app desligado continua sem aviso in-app');
select ok(
  exists (
    select 1 from public.notifications notice
    join due on due.user_id = notice.user_id and due.event_key = notice.event_key
    where notice.user_id = '29e60000-0000-4000-8000-000000000001'
  ),
  'in-app e e-mail compartilham o mesmo id de evento');

-- Ja enviado: nao reenvia (idempotencia pela chave).
insert into public.email_deliveries (user_id, kind, event_key, status, attempts, transport, subject, body, delivered_at)
select user_id, kind, event_key, 'sent', 1, 'brevo', 'Há uma novidade no Elyra', 'Há uma atualização na sua conta.', timezone('utc', now()) from due where user_id = '29e60000-0000-4000-8000-000000000001';
select is(
  (select count(*)::int from public.due_notification_emails('America/Sao_Paulo', 500)
    where user_id = '29e60000-0000-4000-8000-000000000001' and kind = 'professional_verification_update'),
  0, 'evento enviado nao volta a fila');

select ok(
  not has_function_privilege('authenticated', 'public.professional_verification_notify(uuid)', 'EXECUTE'),
  'ninguem autenticado dispara aviso de cadastro diretamente');

select * from finish();
rollback;
