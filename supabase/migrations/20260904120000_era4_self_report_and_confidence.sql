-- Era 4 / 22C - autorrelato por sessao, e confianca na interpretacao.
--
-- **Autorrelato.** A `ADR-0008` decidiu `DEFERRED` para a Era 4, e fixou cinco
-- pontos que esta migration nao redecide: escala 0-10, coleta opcional, ausencia
-- e `null`, nao entra na media diaria sem regra de deduplicacao, e nunca e
-- exibido como contraponto a sinal observado sem explainability ativa.
--
-- O ponto que a tabela precisa carregar sozinha e o quarto e o quinto: o dado
-- e **do que a pessoa disse**, e nao do que o sistema observou. As duas coisas
-- convivem na mesma sessao e nunca se corrigem - divergencia entre elas nao e
-- erro de percepcao de ninguem.
--
-- **Confianca.** `session_interpretations` passa a carregar o nivel declarado
-- pela saida. Sem coluna, "confianca baixa" viveria so dentro do JSON e nao
-- poderia ser consultada, filtrada nem auditada - e a Definition of Done da Era
-- pede que ela **altere o que se afirma**, o que exige que ela seja um fato e
-- nao uma frase.

-- ---------------------------------------------------------------------------
-- 1. Autorrelato por sessao
-- ---------------------------------------------------------------------------

create table if not exists public.session_self_reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique
    references public.multimodal_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  -- Mesma escala de `/meu-humor` (ADR-0008, ponto 1). Divergir quebraria a
  -- comparabilidade e o historico de quem ja registra.
  mood smallint check (mood is null or mood between 0 and 10),
  perceived_anxiety smallint
    check (perceived_anxiety is null or perceived_anxiety between 0 and 10),
  energy smallint check (energy is null or energy between 0 and 10),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  -- Um autorrelato vazio nao e autorrelato. Ausencia continua sendo ausencia de
  -- linha, e nunca uma linha de zeros (ADR-0008, ponto 3).
  constraint session_self_report_has_value check (
    mood is not null or perceived_anxiety is not null or energy is not null
  )
);

comment on table public.session_self_reports is
  'O que a pessoa relatou sobre a propria sessao. SELF_REPORTED, nunca inferido.';
comment on column public.session_self_reports.perceived_anxiety is
  'Ansiedade PERCEBIDA e autorrelatada. O sistema nao mede ansiedade.';

create index if not exists session_self_reports_owner_idx
  on public.session_self_reports (user_id, created_at desc);

create trigger session_self_reports_set_updated_at
before update on public.session_self_reports
for each row execute function public.set_updated_at();

alter table public.session_self_reports enable row level security;
alter table public.session_self_reports force row level security;

create policy session_self_reports_select_own
on public.session_self_reports for select to authenticated
using ((select auth.uid()) = user_id);

create policy session_self_reports_insert_own
on public.session_self_reports for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.multimodal_sessions session
    where session.id = session_self_reports.session_id
      and session.user_id = session_self_reports.user_id
  )
);

create policy session_self_reports_update_own
on public.session_self_reports for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy session_self_reports_delete_own
on public.session_self_reports for delete to authenticated
using ((select auth.uid()) = user_id);

-- Autorrelato acompanha o **resultado** da sessao: ele e parte do que a pessoa
-- escolheu compartilhar sobre aquela sessao, e nao um dominio proprio.
create policy session_self_reports_select_professional
on public.session_self_reports for select to authenticated
using (
  exists (
    select 1 from public.multimodal_sessions session
    where session.id = session_self_reports.session_id
      and session.user_id = session_self_reports.user_id
      and session.share_result_consent
      and public.professional_access_allowed(
        session_self_reports.user_id, 'multimodal_result'
      )
  )
);

grant select, insert, update, delete
  on table public.session_self_reports to authenticated;
grant all on table public.session_self_reports to service_role;

-- ---------------------------------------------------------------------------
-- 2. Confianca declarada da interpretacao
--
-- Coluna, e nao so campo no JSON: a Definition of Done pede que a confianca
-- **altere o que se afirma**. Para isso ela precisa ser consultavel e auditavel,
-- e nao um adjetivo enterrado no payload.
-- ---------------------------------------------------------------------------

alter table public.session_interpretations
  add column if not exists confidence text
    check (confidence is null or confidence in ('low', 'moderate', 'high'));

comment on column public.session_interpretations.confidence is
  'Confianca declarada pela saida. NULL = linha anterior a Era 4, nao "alta".';

-- ---------------------------------------------------------------------------
-- 3. Auditoria
-- ---------------------------------------------------------------------------

create trigger session_self_reports_audit
after insert or update or delete on public.session_self_reports
for each row execute function public.audit_era4_temporal_write();
