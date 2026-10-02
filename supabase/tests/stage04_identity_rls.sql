begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(26);

select has_table('public', 'profiles', 'profiles existe');
select has_table('public', 'user_preferences', 'user_preferences existe');
select has_table('public', 'consent_events', 'consent_events existe');
select has_table('public', 'audit_logs', 'audit_logs existe');

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles usa RLS forcada'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.user_preferences'::regclass),
  'user_preferences usa RLS forcada'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.consent_events'::regclass),
  'consent_events usa RLS forcada'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.audit_logs'::regclass),
  'audit_logs usa RLS forcada'
);

select has_trigger('auth', 'users', 'on_auth_user_created', 'Auth cria identidade 1:1');
select has_trigger('public', 'profiles', 'profiles_set_updated_at', 'profiles atualiza timestamp');
select has_trigger('public', 'user_preferences', 'preferences_set_updated_at', 'preferences atualiza timestamp');
select has_trigger('public', 'consent_events', 'consent_revocation_validate', 'revogacao valida grant do mesmo owner e escopo');

select is((select count(*)::integer from public.profiles), 2, 'seed criou dois profiles');
select is((select count(*)::integer from public.user_preferences), 2, 'seed criou duas preferences');
select is(
  (select public from storage.buckets where id = 'elyra-private'),
  false,
  'bucket Elyra e privado'
);

select ok(not has_table_privilege('anon', 'public.profiles', 'SELECT'), 'anon nao le profiles');
select ok(has_table_privilege('authenticated', 'public.profiles', 'SELECT'), 'authenticated pode consultar profiles sob RLS');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'DELETE'), 'profile nao e apagado isoladamente');
select ok(has_table_privilege('authenticated', 'public.user_preferences', 'SELECT'), 'authenticated pode consultar preferences sob RLS');
select ok(not has_table_privilege('authenticated', 'public.user_preferences', 'DELETE'), 'preferences nao sao apagadas isoladamente');
select ok(has_table_privilege('authenticated', 'public.consent_events', 'SELECT'), 'authenticated consulta consentimento proprio');
select ok(has_table_privilege('authenticated', 'public.consent_events', 'INSERT'), 'authenticated registra evento proprio');
select ok(not has_table_privilege('authenticated', 'public.consent_events', 'UPDATE'), 'consentimento e imutavel');
select ok(has_table_privilege('authenticated', 'public.audit_logs', 'INSERT'), 'authenticated anexa audit proprio');
select ok(not has_table_privilege('authenticated', 'public.audit_logs', 'UPDATE'), 'audit log e append-only');
select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname like 'private_bucket_%_own'
  ),
  4,
  'Storage possui policies owner-only para CRUD'
);

select * from finish();
rollback;
