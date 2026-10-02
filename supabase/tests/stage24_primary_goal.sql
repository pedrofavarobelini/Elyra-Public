begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(6);

select has_column('public', 'user_preferences', 'primary_goal', 'objetivo existe em user_preferences');
select col_is_null('public', 'user_preferences', 'primary_goal', 'objetivo e opcional: null = nao informado');

select lives_ok(
  $$update public.user_preferences set primary_goal = 'sleep' where user_id = (select user_id from public.user_preferences limit 1)$$,
  'valor do vocabulario fechado e aceito'
);
select throws_ok(
  $$update public.user_preferences set primary_goal = 'estou triste' where user_id = (select user_id from public.user_preferences limit 1)$$,
  '23514',
  null,
  'texto livre e recusado pelo check'
);
select lives_ok(
  $$update public.user_preferences set primary_goal = null where user_id = (select user_id from public.user_preferences limit 1)$$,
  'voltar a nao informado e permitido'
);
select ok(
  not has_table_privilege('authenticated', 'public.user_preferences', 'DELETE'),
  'preferencias continuam sem delete isolado'
);

select * from finish();
rollback;
