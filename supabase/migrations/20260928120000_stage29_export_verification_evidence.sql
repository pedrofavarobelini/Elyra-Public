-- ---------------------------------------------------------------------------
-- Stage 29 / Pre-closure - export do titular quebrado desde a Verificacao V2.
--
-- `professional_verification_evidence` foi registrada no export como leitura
-- direta, mas `authenticated` nao tem SELECT nela por desenho (ADR-0028: o
-- usuario nunca le a tabela). Resultado: `/api/me/export` respondia 500 para
-- QUALQUER conta (o export le todas as tabelas registradas).
--
-- Migration **aditiva**: uma funcao nova, so leitura, so as linhas da propria
-- conta, sem `value_digest`. A tabela continua sem grant para `authenticated`.
-- ---------------------------------------------------------------------------

create or replace function public.export_my_verification_evidence()
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(evidence) - 'value_digest'
  from public.professional_verification_evidence evidence
  where evidence.professional_user_id = auth.uid()
  order by evidence.checked_at, evidence.id;
$$;

revoke all on function public.export_my_verification_evidence() from public, anon, service_role;
grant execute on function public.export_my_verification_evidence() to authenticated;
