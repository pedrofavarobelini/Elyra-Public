-- ---------------------------------------------------------------------------
-- Stage 23 / Gate 23-D - consentimento que sobrevive a confirmacao de e-mail.
--
-- Migration **aditiva**. Nenhuma tabela existente e alterada, e `consent_events`
-- continua exatamente como a Stage 04 a definiu.
--
-- ## O problema que ela resolve
--
-- Ligar `enable_confirmations` (mitigacao local do `L-162`) mudou o desfecho do
-- cadastro: `signUp` passa a devolver usuario **sem sessao**. O consentimento de
-- `terms_privacy` era gravado logo depois, com o cliente da propria pessoa — e
-- sem sessao a RLS recusa, corretamente. O resultado seria conta criada sem
-- prova de consentimento, que para um produto de acompanhamento emocional e
-- lacuna de evidencia, e nao detalhe tecnico.
--
-- O comentario de `signupAction` ja previa isto: "o dia em que a confirmacao for
-- ligada esse caminho precisa ser construido". E hoje.
--
-- ## O que NAO foi feito, e por que
--
-- - **service role para contornar a RLS**: proibido. A RLS existe para valer
--   inclusive quando e inconveniente.
-- - **gravar a partir de `raw_user_meta_data`**: esse campo e ditado pela
--   requisicao de cadastro. Serve para `display_name`, onde errar custa um nome
--   errado; nao serve para consentimento, onde errar fabrica prova juridica.
-- - **estender `on_auth_user_created`**: alem da metadata acima, ele dispara
--   para QUALQUER criacao de usuario — API administrativa, OAuth futuro — e
--   afirmaria aceite de termos que ninguem deu.
-- - **acrescentar unique a `consent_events`**: a idempotencia deste fluxo nao
--   justifica alterar uma tabela append-only fundacional que serve a outros
--   quatro propositos.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. O estado transitorio
-- ---------------------------------------------------------------------------

/*
  Isto **nao** e uma segunda fonte da verdade.

  `consent_events` continua sendo o historico. Esta tabela guarda uma *intencao*
  que ainda nao pode virar evento, pela unica razao de que a pessoa ainda nao
  provou posse do e-mail. Ela existe entre o cadastro e a confirmacao, e some
  como fonte no instante em que o evento e criado — `consumed_at` marca isso e a
  linha vira rastro de auditoria, nao estado vigente.
*/
create table if not exists public.pending_consents (
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose ~ '^[a-z][a-z0-9_]{2,63}$'),
  document_version text not null
    check (document_version ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$'),
  created_at timestamptz not null default timezone('utc', now()),
  /* Nulo = ainda nao materializado. Preenchido = ja virou `consent_events`. */
  consumed_at timestamptz,
  consent_event_id uuid references public.consent_events(id) on delete set null,
  primary key (user_id, purpose),
  /*
    Ter evento implica estar consumido — e nao o contrario.

    A forma simetrica (`os dois nulos ou os dois preenchidos`) parece mais
    rigorosa e esta **errada**: a reivindicacao atomica marca `consumed_at`
    ANTES de o evento existir, porque e a marcacao que ganha a corrida entre
    duas abas. `CHECK` e avaliado por comando, nao no fim da transacao, e nao
    pode ser `deferrable` — entao a forma simetrica recusava o proprio passo que
    garante a idempotencia. Inverter a ordem seria pior: uma corrida perdida
    deixaria `consent_events` duplicado e orfao.

    O estado transitorio (consumido, evento ainda por vir) e legitimo e dura o
    tempo de uma funcao. O que nunca pode existir e o inverso: um id de evento
    numa linha que ninguem reivindicou.
  */
  constraint pending_consent_consumption_shape check (
    consent_event_id is null or consumed_at is not null
  )
);

comment on table public.pending_consents is
  'Intencao de consentimento entre o cadastro e a confirmacao de e-mail. Transitoria: vira consent_events no primeiro acesso autenticado.';
comment on column public.pending_consents.consumed_at is
  'Marca a reivindicacao atomica. Preenchido = o evento definitivo ja existe.';

alter table public.pending_consents enable row level security;
alter table public.pending_consents force row level security;

revoke all on table public.pending_consents from anon, authenticated;
/*
  Somente leitura, e somente da propria linha. Escrever e privilegio das duas
  funcoes abaixo: se `authenticated` pudesse inserir aqui, qualquer pessoa
  fabricaria a propria pendencia e o guarda de janela nao valeria nada.
*/
grant select on table public.pending_consents to authenticated;
grant all on table public.pending_consents to service_role;

create policy pending_consents_select_own
on public.pending_consents for select to authenticated
using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 2. Registrar a intencao - chamada pelo cadastro, sem sessao
-- ---------------------------------------------------------------------------

/*
  Executavel por `anon` porque no cadastro ainda nao ha sessao. O que impede
  abuso nao e o papel de quem chama, e sim o que a funcao **verifica**:

  - o usuario existe e ainda **nao** confirmou o e-mail;
  - foi criado ha menos de `p_window`, entao a janela e a de um cadastro em
    andamento, e nao a de uma conta qualquer;
  - ainda nao existe evento definitivo para aquele proposito.

  Forjar exigiria conhecer o UUID de uma conta recem-criada dentro da janela.
  UUID nao e enumeravel e nao e exposto por nenhuma superficie da Elyra, e a
  linha resultante afirma exatamente o que o formulario de cadastro afirmou —
  nada alem. O risco residual esta declarado no dossie da Stage.
*/
create or replace function public.record_pending_consent(
  p_user_id uuid,
  p_purpose text,
  p_document_version text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  window_seconds constant integer := 60;
  candidate auth.users%rowtype;
begin
  select * into candidate from auth.users where id = p_user_id;

  if not found
    or candidate.email_confirmed_at is not null
    or candidate.created_at < timezone('utc', now()) - make_interval(secs => window_seconds)
  then
    return false;
  end if;

  -- Ja ha historico definitivo: a intencao nao tem o que acrescentar.
  if exists (
    select 1 from public.consent_events
    where user_id = p_user_id and purpose = p_purpose
  ) then
    return false;
  end if;

  insert into public.pending_consents (user_id, purpose, document_version)
  values (p_user_id, p_purpose, p_document_version)
  on conflict (user_id, purpose) do nothing;

  return true;
end;
$$;

revoke all on function public.record_pending_consent(uuid, text, text)
from public;
grant execute on function public.record_pending_consent(uuid, text, text)
to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Materializar - no primeiro acesso autenticado
-- ---------------------------------------------------------------------------

/*
  Idempotencia por **reivindicacao**, e nao por verificacao.

  Ler "ja existe evento?" e depois inserir perde a corrida entre duas abas, um
  reload e um retry: as duas leituras acontecem antes de qualquer escrita e as
  duas concluem que falta inserir. Aqui o `update ... where consumed_at is null
  returning` **e** a reivindicacao: o Postgres serializa as concorrentes na
  mesma linha, e apenas a que a encontrar ainda nula segue para o insert. A
  segunda chamada nao devolve linha nenhuma e nao escreve nada.

  Por isso tambem nao foi preciso acrescentar unique a `consent_events`: a
  unicidade vive onde o fluxo acontece.
*/
create or replace function public.materialize_pending_consents()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  claimed public.pending_consents%rowtype;
  created_id uuid;
  created_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  for claimed in
    update public.pending_consents
    set consumed_at = timezone('utc', now())
    where user_id = current_user_id
      and consumed_at is null
    returning *
  loop
    insert into public.consent_events (
      user_id, purpose, document_version, event_type
    ) values (
      current_user_id, claimed.purpose, claimed.document_version, 'granted'
    )
    returning id into created_id;

    update public.pending_consents
    set consent_event_id = created_id
    where user_id = current_user_id and purpose = claimed.purpose;

    insert into public.audit_logs (
      actor_user_id, action, entity_type, entity_id, outcome, correlation_id
    ) values (
      current_user_id, 'consent.materialized', 'consent_event', created_id,
      'success', gen_random_uuid()
    );

    created_count := created_count + 1;
  end loop;

  return created_count;
end;
$$;

revoke all on function public.materialize_pending_consents()
from public, anon, service_role;
grant execute on function public.materialize_pending_consents() to authenticated;
