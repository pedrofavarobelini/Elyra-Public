-- ---------------------------------------------------------------------------
-- Stage 25 / O4 - criacao idempotente de check-in (offline-first, ADR-0014).
--
-- O aparelho offline gera o ID do check-in e a outbox pode reenviar a mesma
-- criacao quando a resposta se perdeu no caminho (a escrita chegou, o ACK nao).
-- Sem idempotencia, cada reenvio seria um check-in a mais.
--
-- Migration **aditiva**: funcao nova. `create_emotional_checkin` e `_v2`
-- continuam existindo e inalteradas.
--
-- Regra: com `id` informado e ja existente **para o mesmo titular**, devolve o
-- registro existente sem tocar em nada (`replayed = true`). O `select` roda com
-- `security invoker`, entao a RLS so enxerga linhas da propria pessoa: um `id`
-- de outra pessoa nao e visivel, o insert colide na chave primaria e falha.
-- ---------------------------------------------------------------------------

create or replace function public.create_emotional_checkin_v3(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  requested_id uuid;
  existing_id uuid;
  existing_occurred_at timestamptz;
  occurred_at_value timestamptz;
  created_id uuid;
begin
  if jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(coalesce(p_payload -> 'factor_ids', '[]'::jsonb)) <> 'array' then
    raise exception 'invalid emotional check-in payload'
      using errcode = '22023';
  end if;

  requested_id := nullif(p_payload ->> 'id', '')::uuid;

  if requested_id is not null then
    select id, occurred_at
      into existing_id, existing_occurred_at
    from public.emotional_checkins
    where id = requested_id
      and user_id = (select auth.uid());

    if existing_id is not null then
      return jsonb_build_object(
        'id', existing_id,
        'occurred_at', existing_occurred_at,
        'replayed', true
      );
    end if;
  end if;

  occurred_at_value := coalesce(
    nullif(p_payload ->> 'occurred_at', '')::timestamptz,
    statement_timestamp()
  );

  insert into public.emotional_checkins (
    id,
    user_id,
    occurred_at,
    mood_score,
    perceived_anxiety_score,
    energy_score,
    primary_feeling,
    note
  )
  values (
    coalesce(requested_id, gen_random_uuid()),
    (select auth.uid()),
    occurred_at_value,
    (p_payload ->> 'mood_score')::smallint,
    (p_payload ->> 'perceived_anxiety_score')::smallint,
    (p_payload ->> 'energy_score')::smallint,
    p_payload ->> 'primary_feeling',
    nullif(btrim(p_payload ->> 'note'), '')
  )
  returning id into created_id;

  insert into public.emotional_checkin_factors (checkin_id, factor_id)
  select created_id, selected.factor_id::uuid
  from (
    select distinct jsonb_array_elements_text(
      coalesce(p_payload -> 'factor_ids', '[]'::jsonb)
    ) as factor_id
  ) selected;

  return jsonb_build_object(
    'id', created_id,
    'occurred_at', occurred_at_value,
    'replayed', false
  );
end;
$$;

revoke all on function public.create_emotional_checkin_v3(jsonb) from public;
grant execute on function public.create_emotional_checkin_v3(jsonb)
to authenticated, service_role;
