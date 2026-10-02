-- Era 3 - a pessoa passa a ver quem acessou o que, e quando.
--
-- **Por que uma tabela nova, e nao `audit_logs`.** A policy de leitura de
-- `audit_logs` e `audit_select_own`: `auth.uid() = actor_user_id`. Um acesso
-- profissional tem o **profissional** como ator, entao registrar ali produziria
-- uma trilha que o titular nunca poderia ler - o oposto exato do que a
-- Definition of Done da Era 3 pede.
--
-- A diferenca e a mesma que a V1 ja aprendeu em `L-058`: *pertencer a alguem* e
-- *dizer respeito a alguem* nao sao a mesma coisa. Esta trilha **pertence ao
-- titular** e tem o profissional como ator, e uma tabela so pode ter uma dessas
-- colunas como dona.
--
-- **O que a trilha guarda.** Quem, qual escopo, quando. Nada de conteudo,
-- nenhum identificador de registro lido - a mesma regra do audit log da V1.
-- Saber que o profissional abriu o dominio emocional as 14h e informacao do
-- titular; saber **qual** check-in ele olhou seria detalhar a leitura de um
-- terceiro sem que isso protegesse ninguem.
--
-- **Limite declarado, e nao escondido.** Esta trilha registra o acesso feito
-- **pela aplicacao**. Quem e a autorizacao continua sendo a RLS: um acesso que a
-- RLS recusa nao acontece, com ou sem trilha. O que a trilha nao promete e
-- registrar leitura feita por fora da aplicacao - fechar isso exigiria remover o
-- `select` direto e passar todo dominio por funcao `security definer`, que e
-- redesenho de arquitetura e pede ADR proprio. Registrado assim para que a
-- garantia lida seja a garantia que existe.

create table public.professional_access_log (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null
    references public.professional_connections(id) on delete cascade,
  client_user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  professional_user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  scope text not null check (scope in (
    'emotional', 'sleep', 'goals', 'journal_entry', 'cycle', 'reports',
    'multimodal_result', 'multimodal_transcript', 'multimodal_media'
  )),
  occurred_at timestamptz not null default timezone('utc', now()),
  constraint professional_access_log_distinct_people
    check (client_user_id <> professional_user_id)
);

comment on table public.professional_access_log is
  'Trilha de acesso profissional, legivel pelo titular. Sem conteudo: quem, qual escopo, quando.';

create index professional_access_log_client_idx
  on public.professional_access_log (client_user_id, occurred_at desc);

alter table public.professional_access_log enable row level security;
alter table public.professional_access_log force row level security;

grant select, insert on table public.professional_access_log to authenticated;
grant all on table public.professional_access_log to service_role;

-- Leitura: **somente o titular**. O profissional nao ganha tela para ver quem o
-- auditou; a trilha existe para a pessoa saber o que aconteceu com o dado dela,
-- e nao para virar vigilancia em qualquer direcao.
create policy professional_access_log_select_client
on public.professional_access_log for select to authenticated
using ((select auth.uid()) = client_user_id);

-- Escrita: so o proprio profissional, e so sobre uma conexao aceita **dele com
-- aquela pessoa**. Ninguem registra acesso em nome de outro, e ninguem registra
-- acesso a quem nao esta conectado.
--
-- Deliberadamente **nao** se exige aqui que o escopo esteja concedido naquele
-- instante. A tentacao seria amarrar as duas coisas, mas quem autoriza a leitura
-- e a RLS do dominio - o log nao reautoriza nada. Amarrar faria a trilha
-- **perder registros** em todo caso de borda (o escopo de diario, por exemplo, e
-- concedido por entrada, e a checagem generica nunca casaria), e log que perde
-- registro em silencio e pior que log ausente: ele afirma completude que nao
-- tem.
create policy professional_access_log_insert_professional
on public.professional_access_log for insert to authenticated
with check (
  professional_user_id = (select auth.uid())
  and exists (
    select 1 from public.professional_connections connection
    where connection.id = professional_access_log.connection_id
      and connection.professional_user_id = (select auth.uid())
      and connection.client_user_id = professional_access_log.client_user_id
      and connection.status = 'accepted'
      and connection.revoked_at is null
  )
);
