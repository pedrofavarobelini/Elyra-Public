begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(10);

select is(
  (select count(*)::integer from storage.buckets where id = 'elyra-private'),
  1,
  'somente o bucket elyra-private esperado existe com esse id'
);
select is(
  (select public from storage.buckets where id = 'elyra-private'),
  false,
  'remediacao preserva o bucket privado'
);
select is(
  (select file_size_limit::bigint from storage.buckets where id = 'elyra-private'),
  33554432::bigint,
  'bucket multimodal limita cada objeto a 32 MiB'
);
select ok(
  (
    select pg_get_constraintdef(oid) like '%33554432%'
      and pg_get_constraintdef(oid) not like '%5242880%'
    from pg_constraint
    where conrelid = 'public.media_assets'::regclass
      and conname = 'media_assets_size_bytes_check'
  ),
  'constraint de metadata usa 32 MiB e nao o teto historico de 5 MiB'
);

insert into public.multimodal_sessions (
  id, user_id, kind, status, camera_consent, storage_consent
) values (
  '94000000-0000-4000-8000-0000000000a1',
  '10000000-0000-4000-8000-000000000001',
  'guided', 'capturing', true, true
);

select lives_ok(
  $$insert into public.media_assets
      (id, session_id, user_id, media_kind, storage_path, mime_type, size_bytes, checksum_sha256)
    values
      ('94000000-0000-4000-8000-0000000000b1',
       '94000000-0000-4000-8000-0000000000a1',
       '10000000-0000-4000-8000-000000000001',
       'camera', 'qa/1-byte.webm', 'video/webm', 1, repeat('a', 64))$$,
  'metadata aceita 1 byte'
);
select lives_ok(
  $$insert into public.media_assets
      (id, session_id, user_id, media_kind, storage_path, mime_type, size_bytes, checksum_sha256)
    values
      ('94000000-0000-4000-8000-0000000000b2',
       '94000000-0000-4000-8000-0000000000a1',
       '10000000-0000-4000-8000-000000000001',
       'camera', 'qa/5-mib.webm', 'video/webm', 5242880, repeat('b', 64))$$,
  'metadata aceita 5 MiB'
);
select lives_ok(
  $$insert into public.media_assets
      (id, session_id, user_id, media_kind, storage_path, mime_type, size_bytes, checksum_sha256)
    values
      ('94000000-0000-4000-8000-0000000000b3',
       '94000000-0000-4000-8000-0000000000a1',
       '10000000-0000-4000-8000-000000000001',
       'camera', 'qa/5-mib-plus-one.webm', 'video/webm', 5242881, repeat('c', 64))$$,
  'metadata aceita tamanho acima de 5 MiB dentro do contrato'
);
select lives_ok(
  $$insert into public.media_assets
      (id, session_id, user_id, media_kind, storage_path, mime_type, size_bytes, checksum_sha256)
    values
      ('94000000-0000-4000-8000-0000000000b4',
       '94000000-0000-4000-8000-0000000000a1',
       '10000000-0000-4000-8000-000000000001',
       'camera', 'qa/32-mib.webm', 'video/webm', 33554432, repeat('d', 64))$$,
  'metadata aceita exatamente 32 MiB'
);
/*
  A leitura profissional de midia exige `status = 'stored'`.

  A policy original da Stage 11 tinha esse filtro; a reescrita da Era 4 que
  acrescentou a janela de tempo o perdeu, expondo metadata de asset `uploading`,
  `interrupted` e - o pior - `deleting`, que e o estado do expurgo e da exclusao
  a pedido do titular. Restaurado em
  `20260904150000_stage22r_media_assets_stored_only.sql`.

  Assercao sobre o **texto da policy** de proposito: o comportamento com
  identidade real e medido pelo `qa:stage11`, que faz upload de verdade; aqui o
  que se tranca e que o filtro nao suma de novo numa proxima reescrita.
*/
select ok(
  (
    select pg_get_expr(polqual, polrelid) like '%stored%'
    from pg_policy
    where polrelid = 'public.media_assets'::regclass
      and polname = 'media_assets_select_professional'
  ),
  'leitura profissional de midia continua exigindo status stored'
);

select throws_ok(
  $$insert into public.media_assets
      (id, session_id, user_id, media_kind, storage_path, mime_type, size_bytes, checksum_sha256)
    values
      ('94000000-0000-4000-8000-0000000000b5',
       '94000000-0000-4000-8000-0000000000a1',
       '10000000-0000-4000-8000-000000000001',
       'camera', 'qa/32-mib-plus-one.webm', 'video/webm', 33554433, repeat('e', 64))$$,
  '23514', null,
  'metadata recusa tamanho acima de 32 MiB'
);

select * from finish();
rollback;
