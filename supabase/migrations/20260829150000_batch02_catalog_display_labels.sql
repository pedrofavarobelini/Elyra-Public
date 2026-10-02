-- Visual Correction Batch 02: diacriticos nos display labels do catalogo.
--
-- Migration aditiva e nao destrutiva. Corrige exclusivamente a coluna de
-- APRESENTACAO (`label`) das linhas `origin = 'system'` dos tres catalogos
-- semeados nas Stages 05, 06 e 07, gravados sem acentuacao na origem.
--
-- Por que esta migration existe. O `VR-001` do Visual Replay cobre toda a copy
-- PT-BR que uma pessoa le na tela. Parte dessa copy nao vive em TypeScript:
-- estes 12 rotulos chegam a interface vindos do banco - chips de fator em
-- `/meu-humor`, tags em `/diario`, sintomas em `/ciclo`. Corrigir o codigo sem
-- corrigir o dado deixaria o defeito visivel para o usuario.
--
-- Chave usada. Sempre o `id` estavel semeado na migration de origem, nunca a
-- propria label. A identidade tecnica e o UUID; a label e apresentacao e pode
-- mudar. Nenhuma linha e localizada por texto.
--
-- Nao altera. `id`, `origin`, `owner_user_id`, `created_at`, schema, coluna,
-- constraint, indice, policy, grant, ownership, enum, FK. Nenhuma linha e
-- inserida e nenhuma e removida. Linhas `origin = 'custom'` nao sao tocadas.
--
-- Idempotente. O predicado `is distinct from` torna a reexecucao um no-op, e o
-- bloco final verifica o estado alvo em vez de assumi-lo. Se uma linha
-- obrigatoria do catalogo nao existir, a migration falha em voz alta: nao ha
-- `insert` de fallback, porque semear catalogo aqui criaria duplicata da
-- migration de origem.

update public.emotional_factors as f
set label = v.new_label
from (values
  ('10000000-0000-4000-8000-000000000004'::uuid, 'Exercício'),
  ('10000000-0000-4000-8000-000000000005'::uuid, 'Família'),
  ('10000000-0000-4000-8000-000000000006'::uuid, 'Saúde'),
  ('10000000-0000-4000-8000-000000000007'::uuid, 'Finanças')
) as v(row_id, new_label)
where f.id = v.row_id
  and f.origin = 'system'
  and f.label is distinct from v.new_label;

update public.journal_tags as t
set label = v.new_label
from (values
  ('20000000-0000-4000-8000-000000000001'::uuid, 'Gratidão'),
  ('20000000-0000-4000-8000-000000000003'::uuid, 'Reflexão'),
  ('20000000-0000-4000-8000-000000000004'::uuid, 'Relações')
) as v(row_id, new_label)
where t.id = v.row_id
  and t.origin = 'system'
  and t.label is distinct from v.new_label;

update public.cycle_symptoms as s
set label = v.new_label
from (values
  ('30000000-0000-4000-8000-000000000001'::uuid, 'Cólica'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'Dor de cabeça'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'Cansaço'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'Inchaço'),
  ('30000000-0000-4000-8000-000000000006'::uuid, 'Alteração de apetite')
) as v(row_id, new_label)
where s.id = v.row_id
  and s.origin = 'system'
  and s.label is distinct from v.new_label;

-- Verificacao do estado alvo. Falha se qualquer linha esperada estiver ausente
-- ou com label diferente do esperado.
do $$
declare
  expected constant text[][] := array[
    ['emotional_factors', '10000000-0000-4000-8000-000000000004', 'Exercício'],
    ['emotional_factors', '10000000-0000-4000-8000-000000000005', 'Família'],
    ['emotional_factors', '10000000-0000-4000-8000-000000000006', 'Saúde'],
    ['emotional_factors', '10000000-0000-4000-8000-000000000007', 'Finanças'],
    ['journal_tags',      '20000000-0000-4000-8000-000000000001', 'Gratidão'],
    ['journal_tags',      '20000000-0000-4000-8000-000000000003', 'Reflexão'],
    ['journal_tags',      '20000000-0000-4000-8000-000000000004', 'Relações'],
    ['cycle_symptoms',    '30000000-0000-4000-8000-000000000001', 'Cólica'],
    ['cycle_symptoms',    '30000000-0000-4000-8000-000000000002', 'Dor de cabeça'],
    ['cycle_symptoms',    '30000000-0000-4000-8000-000000000004', 'Cansaço'],
    ['cycle_symptoms',    '30000000-0000-4000-8000-000000000005', 'Inchaço'],
    ['cycle_symptoms',    '30000000-0000-4000-8000-000000000006', 'Alteração de apetite']
  ];
  i integer;
  found_label text;
begin
  for i in 1 .. array_length(expected, 1) loop
    execute format(
      'select label from public.%I where id = $1 and origin = ''system''',
      expected[i][1]
    ) into found_label using expected[i][2]::uuid;

    if found_label is null then
      raise exception
        'batch02 display labels: linha ausente em public.% (id %)',
        expected[i][1], expected[i][2];
    end if;

    if found_label <> expected[i][3] then
      raise exception
        'batch02 display labels: public.% (id %) esperava % e encontrou %',
        expected[i][1], expected[i][2], expected[i][3], found_label;
    end if;
  end loop;
end
$$;
