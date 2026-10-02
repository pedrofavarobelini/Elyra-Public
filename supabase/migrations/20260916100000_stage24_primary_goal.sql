-- ---------------------------------------------------------------------------
-- Stage 24 / R2 - "Meu objetivo na Elyra".
--
-- Preferencia de produto, e nao avaliacao: a pessoa diz o que espera do
-- aplicativo ("entender melhor meu humor"), e nada e inferido, pontuado ou
-- diagnosticado a partir disso.
--
-- Migration **aditiva**: uma coluna opcional em `user_preferences`, que ja e
-- owner-only com RLS forcada, ja entra na exportacao do titular (descriptor
-- `user_preferences`) e ja cai junto com a conta (`on delete cascade`).
--
-- Vocabulario fechado, sem texto livre: "Outro" nao abre campo digitavel. Um
-- campo livre aqui viraria, cedo ou tarde, o lugar onde alguem escreve o que
-- sente — dado sensivel fora do diario, sem as protecoes do diario.
--
-- `null` = nao informado. Ausencia nao e escolha padrao.
-- ---------------------------------------------------------------------------

alter table public.user_preferences
  add column if not exists primary_goal text;

alter table public.user_preferences
  drop constraint if exists user_preferences_primary_goal_check;
alter table public.user_preferences
  add constraint user_preferences_primary_goal_check
  check (
    primary_goal is null
    or primary_goal in (
      'routine',
      'mood_understanding',
      'sleep',
      'wellbeing',
      'healthy_habits',
      'cycle_tracking',
      'self_knowledge',
      'other'
    )
  );

comment on column public.user_preferences.primary_goal is
  'Objetivo declarado pela pessoa (preferencia de produto, nunca diagnostico). Null = nao informado.';
