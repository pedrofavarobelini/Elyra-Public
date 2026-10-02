-- Stage 22-R: alinha o limite executavel do Storage ao contrato multimodal.
--
-- A Era 4 elevou `MAX_MEDIA_BYTES` e `media_assets_size_bytes_check` para
-- 32 MiB, mas o metadata historico do bucket permaneceu em 5 MiB. Esta
-- migration altera somente o limite do bucket privado existente. Policies,
-- ownership, paths e o flag `public` permanecem intocados.

update storage.buckets
set file_size_limit = 33554432
where id = 'elyra-private';

do $$
begin
  if not exists (
    select 1
    from storage.buckets
    where id = 'elyra-private'
      and file_size_limit = 33554432
  ) then
    raise exception 'ELYRA_PRIVATE_BUCKET_LIMIT_ALIGNMENT_FAILED';
  end if;
end;
$$;
