-- Stage 22-R: devolve `status = 'stored'` a leitura profissional de midia.
--
-- **A regressao.** A policy original da Stage 11 exigia
-- `status = 'stored'` antes de qualquer outra condicao. A migration
-- `20260904130000_era4_professional_multimodal_scope.sql`, ao reescrever a policy
-- para acrescentar a janela de tempo da Era 3, **perdeu esse filtro**. A janela
-- foi acrescentada corretamente; o filtro de status caiu junto, sem intencao.
--
-- **O que isso abria.** Metadata de asset que nunca chegou a ser armazenado, ou
-- que esta sendo apagado, passava a ser legivel pelo profissional:
--
--   `uploading`    - upload em curso, objeto ainda incompleto ou inexistente;
--   `interrupted`  - captura que falhou; o objeto pode nao existir;
--   `deleting`     - expurgo em andamento, ou exclusao pedida pela pessoa.
--
-- O terceiro e o mais grave. `deleting` e o estado em que o expurgo de retencao
-- e a exclusao a pedido do titular trabalham, e a policy de `storage.objects`
-- **continuou** exigindo `stored` - entao o objeto ja estava inacessivel
-- enquanto a linha de metadata seguia legivel. Caminho, tamanho, duracao e
-- checksum de uma gravacao em processo de exclusao nao sao "quase nada": sao a
-- descricao do artefato que a pessoa mandou apagar.
--
-- **Como apareceu.** Nao por teste vermelho. O QA da Stage 11 asseverava que o
-- profissional via **um** asset (`professional_reads_only_stored_shared_asset`);
-- uma sessao anterior de remediacao trocou a assercao para tres e renomeou-a, o
-- que faria a suite passar aceitando o defeito. Revisar a mudanca antes de
-- aceita-la foi o que expos a causa.
--
-- Migration **aditiva**: substitui a policy pela equivalente com o filtro de
-- volta, imediatamente. Nenhuma outra condicao muda - a janela de tempo da Era 3
-- permanece exatamente como a 22D a introduziu.

drop policy if exists media_assets_select_professional on public.media_assets;

create policy media_assets_select_professional
on public.media_assets for select to authenticated
using (
  -- O filtro que voltou. Primeiro, como na Stage 11: o que nao foi armazenado
  -- nao e legivel, e o que esta sendo apagado deixa de ser legivel junto com o
  -- objeto.
  status = 'stored'
  and exists (
    select 1 from public.multimodal_sessions session
    where session.id = media_assets.session_id
      and session.user_id = media_assets.user_id
      and session.share_original_consent
      and public.professional_session_allowed_on(
        media_assets.user_id, 'multimodal_media', media_assets.session_id
      )
  )
);
