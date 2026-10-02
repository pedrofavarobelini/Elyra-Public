-- Visual Correction Batch 02: display labels dos catalogos `origin = 'system'`.
--
-- Este teste protege a copy visivel que vive no BANCO, nao no TypeScript.
-- O guard `tests/ui-copy-ptbr.test.ts` cobre a copy de codigo e nao alcanca
-- estes 12 rotulos, que chegam a tela vindos destas tres tabelas.
--
-- Prova as duas metades do mesmo contrato:
--   1. a LABEL exibida esta acentuada corretamente;
--   2. a IDENTIDADE TECNICA (o `id` estavel) permanece exatamente a mesma.
--
-- Nao e um teste de ortografia do sistema: cobre somente este conjunto.

begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

-- 1. Os 12 rotulos corrigidos pela migration de Batch 02.

select is(
  (select label from public.emotional_factors
   where id = '10000000-0000-4000-8000-000000000004' and origin = 'system'),
  'Exercício', 'emotional_factors: Exercicio -> Exercício');

select is(
  (select label from public.emotional_factors
   where id = '10000000-0000-4000-8000-000000000005' and origin = 'system'),
  'Família', 'emotional_factors: Familia -> Família');

select is(
  (select label from public.emotional_factors
   where id = '10000000-0000-4000-8000-000000000006' and origin = 'system'),
  'Saúde', 'emotional_factors: Saude -> Saúde');

select is(
  (select label from public.emotional_factors
   where id = '10000000-0000-4000-8000-000000000007' and origin = 'system'),
  'Finanças', 'emotional_factors: Financas -> Finanças');

select is(
  (select label from public.journal_tags
   where id = '20000000-0000-4000-8000-000000000001' and origin = 'system'),
  'Gratidão', 'journal_tags: Gratidao -> Gratidão');

select is(
  (select label from public.journal_tags
   where id = '20000000-0000-4000-8000-000000000003' and origin = 'system'),
  'Reflexão', 'journal_tags: Reflexao -> Reflexão');

select is(
  (select label from public.journal_tags
   where id = '20000000-0000-4000-8000-000000000004' and origin = 'system'),
  'Relações', 'journal_tags: Relacoes -> Relações');

select is(
  (select label from public.cycle_symptoms
   where id = '30000000-0000-4000-8000-000000000001' and origin = 'system'),
  'Cólica', 'cycle_symptoms: Colica -> Cólica');

select is(
  (select label from public.cycle_symptoms
   where id = '30000000-0000-4000-8000-000000000002' and origin = 'system'),
  'Dor de cabeça', 'cycle_symptoms: Dor de cabeca -> Dor de cabeça');

select is(
  (select label from public.cycle_symptoms
   where id = '30000000-0000-4000-8000-000000000004' and origin = 'system'),
  'Cansaço', 'cycle_symptoms: Cansaco -> Cansaço');

select is(
  (select label from public.cycle_symptoms
   where id = '30000000-0000-4000-8000-000000000005' and origin = 'system'),
  'Inchaço', 'cycle_symptoms: Inchaco -> Inchaço');

select is(
  (select label from public.cycle_symptoms
   where id = '30000000-0000-4000-8000-000000000006' and origin = 'system'),
  'Alteração de apetite',
  'cycle_symptoms: Alteracao de apetite -> Alteração de apetite');

-- 2. Os 6 rotulos que ja estavam corretos seguem intocados.

select is(
  (select label from public.emotional_factors
   where id = '10000000-0000-4000-8000-000000000001'),
  'Trabalho', 'emotional_factors: Trabalho intocado');

select is(
  (select label from public.emotional_factors
   where id = '10000000-0000-4000-8000-000000000002'),
  'Estudos', 'emotional_factors: Estudos intocado');

select is(
  (select label from public.emotional_factors
   where id = '10000000-0000-4000-8000-000000000003'),
  'Sono', 'emotional_factors: Sono intocado');

select is(
  (select label from public.emotional_factors
   where id = '10000000-0000-4000-8000-000000000008'),
  'Vida social', 'emotional_factors: Vida social intocado');

select is(
  (select label from public.journal_tags
   where id = '20000000-0000-4000-8000-000000000002'),
  'Trabalho', 'journal_tags: Trabalho intocado');

select is(
  (select label from public.cycle_symptoms
   where id = '30000000-0000-4000-8000-000000000003'),
  'Sensibilidade', 'cycle_symptoms: Sensibilidade intocado');

-- 3. Catalogo completo: par (id, label) exato, sem linha extra e sem duplicata.
--    O `bag_eq` reprova tanto label errada quanto id alterado ou linha a mais.

select bag_eq(
  $$select id::text, label from public.emotional_factors where origin = 'system'$$,
  $$values
    ('10000000-0000-4000-8000-000000000001'::text, 'Trabalho'::text),
    ('10000000-0000-4000-8000-000000000002', 'Estudos'),
    ('10000000-0000-4000-8000-000000000003', 'Sono'),
    ('10000000-0000-4000-8000-000000000004', 'Exercício'),
    ('10000000-0000-4000-8000-000000000005', 'Família'),
    ('10000000-0000-4000-8000-000000000006', 'Saúde'),
    ('10000000-0000-4000-8000-000000000007', 'Finanças'),
    ('10000000-0000-4000-8000-000000000008', 'Vida social')$$,
  'emotional_factors: catalogo system final exato (id + label)');

select bag_eq(
  $$select id::text, label from public.journal_tags where origin = 'system'$$,
  $$values
    ('20000000-0000-4000-8000-000000000001'::text, 'Gratidão'::text),
    ('20000000-0000-4000-8000-000000000002', 'Trabalho'),
    ('20000000-0000-4000-8000-000000000003', 'Reflexão'),
    ('20000000-0000-4000-8000-000000000004', 'Relações')$$,
  'journal_tags: catalogo system final exato (id + label)');

select bag_eq(
  $$select id::text, label from public.cycle_symptoms where origin = 'system'$$,
  $$values
    ('30000000-0000-4000-8000-000000000001'::text, 'Cólica'::text),
    ('30000000-0000-4000-8000-000000000002', 'Dor de cabeça'),
    ('30000000-0000-4000-8000-000000000003', 'Sensibilidade'),
    ('30000000-0000-4000-8000-000000000004', 'Cansaço'),
    ('30000000-0000-4000-8000-000000000005', 'Inchaço'),
    ('30000000-0000-4000-8000-000000000006', 'Alteração de apetite')$$,
  'cycle_symptoms: catalogo system final exato (id + label)');

-- 4. Nenhuma duplicata de catalogo foi criada pela migration corretiva.

select is(
  (select count(*) from public.emotional_factors where origin = 'system'),
  8::bigint, 'emotional_factors: 8 fatores system, sem duplicata');

select is(
  (select count(*) from public.journal_tags where origin = 'system'),
  4::bigint, 'journal_tags: 4 tags system, sem duplicata');

select is(
  (select count(*) from public.cycle_symptoms where origin = 'system'),
  6::bigint, 'cycle_symptoms: 6 sintomas system, sem duplicata');

select * from finish();

rollback;
