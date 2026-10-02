-- Era 2 - corrigir e completar check-in passado.
--
-- A vida nao acontece na hora do formulario: quem esqueceu de registrar ontem,
-- ou registrou errado, precisa poder consertar. A V1 sabia **criar** com data
-- passada (`create_emotional_checkin_v2` aceita `occurred_at`), mas nao sabia
-- editar.
--
-- E nao sabia de forma segura: `emotional_checkins` tem RLS **forcada** e
-- policies apenas de `select` e `insert`. Sem policy de `update`, toda tentativa
-- de edicao era negada - o padrao correto, e a razao pela qual esta migration
-- precisa ser explicita sobre o que passa a ser permitido.
--
-- Migration aditiva: nenhuma policy existente e alterada ou removida.

-- `authenticated` nao tinha `UPDATE` nesta tabela: a V1 nunca precisou editar
-- check-in, e o grant nunca foi concedido. Policy sem grant nao permite nada -
-- os dois sao necessarios, e conceder apenas `UPDATE` mantem `DELETE` fora do
-- alcance (apagar continua sendo o fluxo de direitos do titular, e nao um efeito
-- colateral de editar).
grant update on table public.emotional_checkins to authenticated;
grant delete on table public.emotional_checkin_factors to authenticated;

-- Editar o proprio check-in. `using` decide quais linhas a pessoa alcanca;
-- `with check` decide como elas podem ficar depois. Os dois sao necessarios:
-- sem o segundo, uma linha poderia ser reatribuida a outra pessoa pela propria
-- edicao.
create policy emotional_checkins_update_own
on public.emotional_checkins for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Trocar os fatores de um check-in exige apagar os vinculos antigos. A condicao
-- espelha a de `select`/`insert`: o vinculo pertence a quem e dono do check-in.
create policy emotional_checkin_factors_delete_own
on public.emotional_checkin_factors for delete to authenticated
using (
  exists (
    select 1
    from public.emotional_checkins checkin
    where checkin.id = checkin_id
      and checkin.user_id = (select auth.uid())
  )
);

/**
 * Atualiza um check-in e substitui os fatores dele, numa unica transacao.
 *
 * `security invoker`: a RLS da pessoa vale aqui dentro. A funcao nunca escreve
 * `user_id` e nunca recebe um - a propriedade e decidida pela policy, e nao por
 * um parametro que o chamador poderia mentir.
 *
 * Levanta quando nada foi atualizado, em vez de devolver sucesso silencioso.
 * Check-in inexistente e check-in de outra pessoa sao **indistinguiveis** de
 * fora, de proposito: responder "existe, mas nao e seu" ja seria contar algo
 * sobre outra pessoa.
 */
create or replace function public.update_emotional_checkin(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_id uuid := nullif(p_payload ->> 'id', '')::uuid;
  occurred_at_value timestamptz;
  updated_at_value timestamptz;
  affected bigint;
begin
  if jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(coalesce(p_payload -> 'factor_ids', '[]'::jsonb)) <> 'array'
    or target_id is null then
    raise exception 'invalid emotional check-in payload'
      using errcode = '22023';
  end if;

  -- Um check-in sem nenhum dado emocional nao e um registro - e uma linha
  -- vazia. A regra ja existe no formulario; existir aqui tambem impede que
  -- outro caminho a contorne.
  if (p_payload ->> 'mood_score') is null
    and (p_payload ->> 'perceived_anxiety_score') is null
    and (p_payload ->> 'energy_score') is null
    and (p_payload ->> 'primary_feeling') is null then
    raise exception 'emotional check-in requires at least one value'
      using errcode = '22023';
  end if;

  -- `occurred_at` ausente no payload mantem a data original. Corrigir o humor
  -- de ontem nao deve mover o registro para hoje.
  occurred_at_value := nullif(p_payload ->> 'occurred_at', '')::timestamptz;

  update public.emotional_checkins
  set
    occurred_at = coalesce(occurred_at_value, occurred_at),
    mood_score = (p_payload ->> 'mood_score')::smallint,
    perceived_anxiety_score = (p_payload ->> 'perceived_anxiety_score')::smallint,
    energy_score = (p_payload ->> 'energy_score')::smallint,
    primary_feeling = p_payload ->> 'primary_feeling',
    note = nullif(btrim(p_payload ->> 'note'), '')
  where id = target_id
  returning occurred_at into updated_at_value;
  get diagnostics affected = row_count;

  -- Contagem de linhas, e nao o valor devolvido: usar `occurred_at` como
  -- sentinela dependeria de ele ser `not null` para sempre.
  if affected = 0 then
    raise exception 'emotional check-in not found'
      using errcode = 'P0002';
  end if;

  delete from public.emotional_checkin_factors where checkin_id = target_id;
  insert into public.emotional_checkin_factors (checkin_id, factor_id)
  select target_id, selected.factor_id::uuid
  from (
    select distinct jsonb_array_elements_text(
      coalesce(p_payload -> 'factor_ids', '[]'::jsonb)
    ) as factor_id
  ) selected;

  return jsonb_build_object('id', target_id, 'occurred_at', updated_at_value);
end;
$$;

revoke all on function public.update_emotional_checkin(jsonb) from public;
grant execute on function public.update_emotional_checkin(jsonb)
  to authenticated, service_role;
