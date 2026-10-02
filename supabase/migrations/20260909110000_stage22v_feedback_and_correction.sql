-- Stage 22-V - feedback de produto e correcao humana de transcricao.
--
-- ## As tres coisas que este arquivo mantem separadas
--
-- 1. **Avaliar a transcricao** e dizer que o reconhecedor errou.
-- 2. **Avaliar a interpretacao** e dizer que o Veltrix leu mal os sinais.
-- 3. **Corrigir a transcricao** e dizer o que a pessoa realmente falou.
--
-- Um polegar para baixo na transcricao nao e um polegar para baixo no Veltrix:
-- sao dois sistemas, com dois modos de errar. Fundi-los produziria uma metrica
-- que nao serve para melhorar nenhum dos dois.
--
-- E nenhum dos tres e ordem de treinamento. `FEEDBACK != TRAINING`,
-- `CORRECTION != TRAINING`: a coluna `training_eligible` nasce `false` e nao ha
-- caminho automatico que a vire. Alguem que corrige um nome proprio nao esta
-- doando a propria voz para treinar modelo, e tratar a correcao como doacao
-- seria transformar um gesto de conserto em consentimento que ninguem deu.
--
-- ## O original e imutavel
--
-- `ASR_ORIGINAL != USER_CORRECTION`. A correcao NAO faz `update` no texto de
-- `session_transcripts`: ela e uma linha propria, que guarda o original ao lado
-- do corrigido. Sobrescrever faria o sistema afirmar que o ASR produziu algo que
-- ele nao produziu, apagaria a evidencia de que houve erro e tornaria impossivel
-- medir qualidade depois.

-- ---------------------------------------------------------------------------
-- 1. Avaliacao (polegar) - transcricao E interpretacao
-- ---------------------------------------------------------------------------

create table if not exists public.session_feedback (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.multimodal_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,

  -- O alvo e tipado justamente para que as duas avaliacoes nunca se misturem
  -- numa media so.
  target_type text not null check (target_type in ('transcription', 'interpretation')),
  -- Qual linha foi avaliada. `null` e legitimo: a transcricao pode ter sido
  -- avaliada e depois apagada por retencao, e apagar a avaliacao junto perderia
  -- o registro de que alguem reclamou.
  target_id uuid,

  rating text not null check (rating in ('positive', 'negative')),

  -- Vocabulario fechado, e so faz sentido em avaliacao negativa. Ele descreve o
  -- ERRO DA MAQUINA, e nunca a pessoa: nenhum valor aqui e sobre quem falou.
  reason text check (reason in (
    'incorrect_text',
    'missing_word',
    'added_word',
    'incorrect_number_or_name',
    'other'
  )),

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  -- Uma avaliacao por alvo por pessoa. Trocar de ideia atualiza a linha; nao
  -- acumula votos, que transformaria insistencia em peso.
  constraint session_feedback_one_per_target unique (user_id, session_id, target_type),

  -- Motivo so acompanha recusa. Um "gostei, porque a palavra faltou" e
  -- contraditorio, e aceita-lo produziria dado que ninguem sabe ler.
  constraint session_feedback_reason_shape check (
    (rating = 'negative') or (rating = 'positive' and reason is null)
  ),

  -- Motivo de transcricao nao descreve interpretacao: o vocabulario acima fala
  -- de palavra, numero e nome, que sao categorias do reconhecedor.
  constraint session_feedback_reason_scope check (
    reason is null or target_type = 'transcription'
  )
);

comment on table public.session_feedback is
  'Avaliacao de produto da pessoa usuaria. NAO e dado clinico, NAO vai ao profissional e NAO inicia treinamento.';
comment on column public.session_feedback.target_type is
  'Transcricao e interpretacao sao sistemas diferentes: um polegar para baixo num nao e no outro.';

create index if not exists session_feedback_owner_idx
  on public.session_feedback (user_id, created_at desc);
create index if not exists session_feedback_session_idx
  on public.session_feedback (session_id, target_type);

create trigger session_feedback_set_updated_at
before update on public.session_feedback
for each row execute function public.set_updated_at();

alter table public.session_feedback enable row level security;
alter table public.session_feedback force row level security;

create policy session_feedback_select_own
on public.session_feedback for select to authenticated
using ((select auth.uid()) = user_id);

create policy session_feedback_insert_own
on public.session_feedback for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.multimodal_sessions session
    where session.id = session_feedback.session_id
      and session.user_id = session_feedback.user_id
  )
);

create policy session_feedback_update_own
on public.session_feedback for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Remover a avaliacao e um direito: quem avaliou pode desavaliar.
create policy session_feedback_delete_own
on public.session_feedback for delete to authenticated
using ((select auth.uid()) = user_id);

/*
  NAO existe policy de profissional aqui, e a ausencia e deliberada.

  Avaliacao de produto e uma opiniao sobre a ferramenta, e nao sobre a pessoa.
  "Achei a transcricao ruim" nao e informacao clinica, e leva-la ao dossie
  profissional a transformaria em dado sobre quem falou - alem de mudar o que a
  pessoa sente ao clicar no polegar, que passaria a ser uma mensagem para o seu
  profissional em vez de um reparo na ferramenta.
*/

grant select, insert, update, delete on table public.session_feedback to authenticated;
grant all on table public.session_feedback to service_role;

-- ---------------------------------------------------------------------------
-- 2. Correcao humana da transcricao
-- ---------------------------------------------------------------------------

create table if not exists public.transcript_corrections (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.multimodal_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  transcript_id uuid
    references public.session_transcripts(id) on delete set null,

  /*
    O texto que o ASR produziu, copiado no momento da correcao.

    Duplicacao deliberada, e a unica do arquivo: sem ela, a retencao apagaria o
    original e restaria so o texto corrigido, sem nada que dissesse o que foi
    corrigido. A comparacao entre os dois E a informacao.
  */
  original_content text not null
    check (char_length(original_content) between 1 and 20000),
  corrected_content text not null
    check (char_length(corrected_content) between 1 and 20000),

  -- Qual motor produziu o original. A correcao de uma saida do Whisper local nao
  -- diz nada sobre o reconhecedor nativo.
  original_source text not null,

  revision integer not null default 1 check (revision >= 1),

  /*
    `FEEDBACK != TRAINING`.

    Nasce `false` e nao ha gatilho, job ou caminho de aplicacao que a vire.
    Elegibilidade futura passaria por revisao e autorizacao explicitas -
    coletado, revisado, autorizado, elegivel -, e nunca por efeito colateral de
    alguem consertar um nome proprio.
  */
  training_eligible boolean not null default false,

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  -- Revogacao preserva a linha e a marca. Apagar perderia o rastro de que a
  -- correcao existiu, e o dataset futuro precisa saber o que foi revogado.
  revoked_at timestamptz,

  -- Corrigir para o texto identico nao e correcao.
  constraint transcript_correction_changes_something
    check (corrected_content <> original_content),

  constraint transcript_correction_one_per_revision
    unique (session_id, revision)
);

comment on table public.transcript_corrections is
  'Revisao humana da transcricao. Entidade SEPARADA: o original nunca e sobrescrito.';
comment on column public.transcript_corrections.training_eligible is
  'Sempre false por padrao. Correcao NAO e consentimento de treinamento.';

create index if not exists transcript_corrections_owner_idx
  on public.transcript_corrections (user_id, created_at desc);
create index if not exists transcript_corrections_session_idx
  on public.transcript_corrections (session_id, revision desc);

create trigger transcript_corrections_set_updated_at
before update on public.transcript_corrections
for each row execute function public.set_updated_at();

/*
  O banco recusa que uma correcao ligue o proprio treinamento.

  A regra ja existe no servico, e uma regra que so existe na aplicacao vale ate
  o primeiro script que escreva direto na tabela. Esta e a que nao depende de
  ninguem lembrar.
*/
create or replace function public.transcript_correction_training_is_never_automatic()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.training_eligible then
    raise exception
      'correcao nao nasce elegivel para treinamento (FEEDBACK != TRAINING)';
  end if;
  if tg_op = 'UPDATE'
     and new.training_eligible
     and not old.training_eligible then
    raise exception
      'elegibilidade de treinamento exige autorizacao governada, nao update direto';
  end if;
  return new;
end;
$$;

create trigger transcript_corrections_no_automatic_training
before insert or update on public.transcript_corrections
for each row execute function public.transcript_correction_training_is_never_automatic();

alter table public.transcript_corrections enable row level security;
alter table public.transcript_corrections force row level security;

create policy transcript_corrections_select_own
on public.transcript_corrections for select to authenticated
using ((select auth.uid()) = user_id);

create policy transcript_corrections_insert_own
on public.transcript_corrections for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.multimodal_sessions session
    where session.id = transcript_corrections.session_id
      and session.user_id = transcript_corrections.user_id
  )
);

create policy transcript_corrections_update_own
on public.transcript_corrections for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy transcript_corrections_delete_own
on public.transcript_corrections for delete to authenticated
using ((select auth.uid()) = user_id);

/*
  O profissional so ve a correcao dentro do que ja foi compartilhado.

  A correcao pertence a transcricao. Se a pessoa compartilhou o resultado da
  sessao, mostrar o texto que o ASR errou e esconder a correcao dela seria pior
  que nao mostrar nada: o profissional leria como fala o que a propria pessoa ja
  disse que nao foi dito.

  A condicao e a MESMA da transcricao compartilhada, e nao uma mais frouxa:
  consentimento de compartilhar resultado E acesso profissional vigente. Uma
  correcao numa sessao nao compartilhada continua invisivel.

  Revogada nao viaja: `revoked_at is null`.
*/
create policy transcript_corrections_select_professional
on public.transcript_corrections for select to authenticated
using (
  transcript_corrections.revoked_at is null
  and exists (
    select 1 from public.multimodal_sessions session
    where session.id = transcript_corrections.session_id
      and session.user_id = transcript_corrections.user_id
      and session.share_result_consent
      and public.professional_access_allowed(
        transcript_corrections.user_id, 'multimodal_result'
      )
  )
);

grant select, insert, update, delete on table public.transcript_corrections to authenticated;
grant all on table public.transcript_corrections to service_role;
