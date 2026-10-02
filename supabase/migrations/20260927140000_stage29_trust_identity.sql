-- Verificacao V2 (ADR-0028) — Trust Profile: "Identidade" publica como FATO.
--
-- Projecao publica minima: um booleano. Verdadeiro so se a evidencia mais
-- recente do fato `identity_match` for PASS com assurance >= documento
-- conferido e de fonte real (nunca `qa_fixture`). Sem fonte, provider,
-- digest, data ou quem conferiu. Mesmas condicoes do perfil publico: conta
-- autenticada, perfil listado, verificacao vigente.

create or replace function public.professional_directory_identity_verified(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select e.status = 'PASS'
       and e.assurance in ('identity_document_crosschecked', 'identity_strongly_verified')
       and e.source_type <> 'qa_fixture'
    from public.professional_public_profiles pub
    join public.professional_verification_evidence e on e.professional_user_id = pub.user_id
    where auth.uid() is not null
      and p_slug ~ '^[0-9a-f]{16}$'
      and pub.slug = p_slug
      and pub.listed
      and public.professional_verification_is_current(pub.user_id)
      and e.fact_type = 'identity_match'
    order by e.checked_at desc
    limit 1
  ), false);
$$;

revoke all on function public.professional_directory_identity_verified(text) from public, anon, service_role;
grant execute on function public.professional_directory_identity_verified(text) to authenticated;
