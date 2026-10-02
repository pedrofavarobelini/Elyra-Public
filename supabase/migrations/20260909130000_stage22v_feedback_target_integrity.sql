-- Stage 22-V - integridade do alvo do feedback.
--
-- Migration ADITIVA, separada da correcao de escopo: sao dois findings sem
-- relacao entre si, e cada um deve poder ser revertido sozinho.
--
-- ---------------------------------------------------------------------------
-- 4. FINDING MEDIUM - o alvo do feedback nao era verificado
-- ---------------------------------------------------------------------------
--
-- `session_feedback.target_id` aceitava qualquer UUID. A RLS provava que a
-- SESSAO e da pessoa, e nao provava nada sobre o alvo: dava para avaliar uma
-- "transcricao" apontando para o id de uma interpretacao, para a transcricao de
-- outra sessao, ou para uma linha de outra pessoa.
--
-- Nao e vazamento - nada disso permite LER o alvo. E proveniencia falsa: uma
-- avaliacao que diz respeito a uma coisa e aponta para outra. Feedback governado
-- nao sobrevive a isso, e um dataset futuro herdaria o erro sem saber.
--
-- A associacao e polimorfica (`target_type` decide a tabela), entao uma FK
-- simples nao resolve. A verificacao vive num trigger fail-closed, e a mesma
-- regra existe no service: confiar so na aplicacao deixaria escrita direta pelo
-- PostgREST contornar tudo.

create or replace function public.session_feedback_target_belongs_to_session()
returns trigger
language plpgsql
-- `security definer` de proposito, e com o minimo: o trigger precisa enxergar
-- a linha alvo para confirmar que ela existe naquela sessao e daquela pessoa,
-- e a RLS do proprio chamador ja restringe o que ele pode gravar. `invoker`
-- faria a verificacao depender das policies de leitura de cada tabela alvo, e
-- um alvo invisivel passaria por inexistente - fail-open silencioso.
security definer
set search_path = ''
as $$
begin
  -- `null` continua permitido: e como um alvo que ja nao existe por retencao
  -- fica representado. Ausencia declarada, e nao alvo inventado.
  if new.target_id is null then
    return new;
  end if;

  if new.target_type = 'transcription' then
    if not exists (
      select 1 from public.session_transcripts transcript
      where transcript.id = new.target_id
        and transcript.session_id = new.session_id
        and transcript.user_id = new.user_id
    ) then
      raise exception
        'ELYRA_FEEDBACK_TARGET_NOT_IN_SESSION'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.target_type = 'interpretation' then
    if not exists (
      select 1 from public.session_interpretations interpretation
      where interpretation.id = new.target_id
        and interpretation.session_id = new.session_id
        and interpretation.user_id = new.user_id
    ) then
      raise exception
        'ELYRA_FEEDBACK_TARGET_NOT_IN_SESSION'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Tipo desconhecido nao passa por omissao. O `check` da coluna ja recusa,
  -- e aqui a recusa e repetida porque um tipo novo adicionado sem atualizar
  -- esta funcao nao pode virar alvo sem verificacao.
  raise exception
    'ELYRA_FEEDBACK_TARGET_TYPE_UNVERIFIED'
    using errcode = 'check_violation';
end;
$$;

revoke all on function public.session_feedback_target_belongs_to_session() from public;

-- Idempotente: uma migration aditiva precisa poder ser reaplicada sobre um
-- banco que ja a tem, sem depender de o trigger nao existir.
drop trigger if exists session_feedback_target_integrity on public.session_feedback;
create trigger session_feedback_target_integrity
before insert or update on public.session_feedback
for each row execute function public.session_feedback_target_belongs_to_session();

comment on column public.session_feedback.target_id is
  'A linha avaliada, verificada por trigger: precisa pertencer a MESMA sessao e a MESMA pessoa. `null` representa alvo que ja nao existe por retencao, e nunca alvo desconhecido.';
