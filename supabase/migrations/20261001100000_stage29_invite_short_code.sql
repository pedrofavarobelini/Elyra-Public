-- Stage 29 — codigo curto de convite (L-432), aviso de aceite ao profissional
-- (L-433), aceite idempotente para o proprio titular (L-435) e fechamento do
-- caminho legado por UUID (L-434). Mapeamento:
--
-- **Aditiva.** Nenhuma tabela nova, nenhuma coluna removida, nenhuma linha
-- migrada. So funcoes (create or replace + uma nova), um indice, a ampliacao
-- dos catalogos de notificacao e um `revoke execute`.
--
-- **Formato.** `ELY-XXXXX-XXXXX`: prefixo fixo (apresentacao) + 10 simbolos do
-- alfabeto Crockford base32 (`0-9 A-Z` sem `I L O U`), 5 bits cada = 50 bits,
-- gerados por `gen_random_bytes` (CSPRNG; `byte & 31` e uniforme porque 256 e
-- multiplo de 32). O codigo **continua sendo o segredo**: o banco guarda
-- `sha256('ELY-XXXXX-XXXXX')` (forma canonica), nunca o valor.
--
-- **Normalizacao (no banco, fonte unica).** Aceita caixa baixa, hifen ou espaco
-- como separador, espacos nas pontas e o prefixo opcional. Os glifos `O`, `I`
-- e `L` **nao existem** no alfabeto: sao lidos como `0`, `1`, `1` (regra
-- Crockford). Um codigo valido nunca e reescrito em outro; a correcao so toca
-- caracteres que nenhum codigo contem. `U` e qualquer outro simbolo invalidam.
--
-- **Transicao.** Tokens longos (43 caracteres base64url, PRO-2) continuam
-- resolvendo pelo digest do valor exato ate expirarem (TTL de 72 h). Nenhum
-- token longo e mais gerado a partir desta migration.
--
-- **Limitador.** Continua 10 negativas por ator em 10 min. Novo: quando o
-- banco inteiro passa de 200 negativas em 10 min (sinal de ataque distribuido
-- entre contas), o teto por ator cai para 3. Quem digita o codigo certo nunca
-- tem negativa e nunca e bloqueado: nao ha DoS contra um convite legitimo.

-- ---------------------------------------------------------------------------
-- 1. Forma canonica e digest de busca
-- ---------------------------------------------------------------------------

create or replace function public.professional_invite_lookup_digest(p_input text)
returns bytea
language plpgsql
immutable
set search_path = ''
as $$
declare
  trimmed text;
  compact text;
begin
  if p_input is null then
    return null;
  end if;
  trimmed := btrim(p_input, E' \t\r\n');
  -- Transicao: token longo do PRO-2, comparado byte a byte.
  if trimmed ~ '^[A-Za-z0-9_-]{43}$' then
    return extensions.digest(convert_to(trimmed, 'UTF8'), 'sha256');
  end if;
  if char_length(trimmed) > 32 then
    return null;
  end if;
  compact := upper(regexp_replace(trimmed, '[[:space:]-]', '', 'g'));
  -- `L` nao existe no alfabeto: a parte aleatoria nunca comeca com "ELY".
  if char_length(compact) = 13 and left(compact, 3) = 'ELY' then
    compact := substr(compact, 4);
  end if;
  compact := translate(compact, 'OIL', '011');
  if compact !~ '^[0-9A-HJKMNP-TV-Z]{10}$' then
    return null;
  end if;
  return extensions.digest(
    convert_to('ELY-' || substr(compact, 1, 5) || '-' || substr(compact, 6, 5), 'UTF8'),
    'sha256'
  );
end;
$$;

revoke all on function public.professional_invite_lookup_digest(text) from public, anon, authenticated, service_role;

create or replace function public.professional_invite_new_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  random_bytes bytea := extensions.gen_random_bytes(10);
  symbols text := '';
begin
  for idx in 0..9 loop
    symbols := symbols || substr(alphabet, (get_byte(random_bytes, idx) & 31) + 1, 1);
  end loop;
  return 'ELY-' || substr(symbols, 1, 5) || '-' || substr(symbols, 6, 5);
end;
$$;

revoke all on function public.professional_invite_new_code() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Limitador: por ator + modo de ataque distribuido
-- ---------------------------------------------------------------------------

create index if not exists audit_logs_action_occurred_idx
  on public.audit_logs (action, occurred_at desc);

create or replace function public.professional_invite_attempts_exceeded(p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with own as (
    select count(*) as attempts from public.audit_logs log
    where log.actor_user_id = p_actor
      and log.action = 'professional_invite.redeem_denied'
      and log.occurred_at > statement_timestamp() - interval '10 minutes'
  ), everyone as (
    select count(*) as attempts from (
      select 1 from public.audit_logs log
      where log.action = 'professional_invite.redeem_denied'
        and log.occurred_at > statement_timestamp() - interval '10 minutes'
      limit 200
    ) capped
  )
  select case
    when (select attempts from everyone) >= 200 then (select attempts from own) >= 3
    else (select attempts from own) >= 10
  end;
$$;

revoke all on function public.professional_invite_attempts_exceeded(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Criacao: so o formato curto
-- ---------------------------------------------------------------------------

create or replace function public.create_professional_invite()
returns table (invite_id uuid, token text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  raw_code text;
  created public.professional_invites%rowtype;
  live_count integer;
  attempt integer := 0;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not public.professional_verification_is_current(actor_id) then
    raise exception 'verified professional required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('professional_invite:' || actor_id::text, 0)
  );
  select count(*) into live_count from public.professional_invites invite
  where invite.professional_user_id = actor_id
    and invite.state in ('created', 'opened')
    and invite.expires_at > statement_timestamp();
  if live_count >= 20 then
    raise exception 'invite limit reached' using errcode = '54000';
  end if;

  -- Colisao em 2^50 e improvavel; o digest unico decide, e a geracao repete.
  loop
    attempt := attempt + 1;
    raw_code := public.professional_invite_new_code();
    begin
      insert into public.professional_invites (
        professional_user_id, token_digest, expires_at, policy_version
      ) values (
        actor_id,
        public.professional_invite_lookup_digest(raw_code),
        statement_timestamp() + interval '72 hours',
        'stage29.invite.short.v1'
      ) returning * into created;
      exit;
    exception when unique_violation then
      if attempt >= 5 then
        raise;
      end if;
    end;
  end loop;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, 'professional_invite.created', 'professional_invite', created.id,
    'success', gen_random_uuid()
  );

  invite_id := created.id;
  token := raw_code;
  expires_at := created.expires_at;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Resolucao (preview/accept/decline): mesma regra, digest normalizado
-- ---------------------------------------------------------------------------

create or replace function public.professional_invite_resolve(
  p_actor uuid,
  p_token text
)
returns public.professional_invites
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  lookup bytea := public.professional_invite_lookup_digest(p_token);
  found_invite public.professional_invites%rowtype;
begin
  if lookup is null then
    return null;
  end if;
  select * into found_invite from public.professional_invites
  where token_digest = lookup
  for update;
  if not found then
    return null;
  end if;
  if found_invite.state in ('created', 'opened')
    and found_invite.expires_at <= statement_timestamp() then
    -- Materializa a expiracao. Nunca e revertida.
    update public.professional_invites
    set state = 'expired', expired_at = statement_timestamp()
    where id = found_invite.id;
    return null;
  end if;
  if found_invite.state not in ('created', 'opened')
    or found_invite.professional_user_id = p_actor
    or not public.professional_verification_is_current(found_invite.professional_user_id) then
    return null;
  end if;
  return found_invite;
end;
$$;

revoke all on function public.professional_invite_resolve(uuid, text) from public, anon, authenticated, service_role;

-- Preview com o mesmo nome que o aceite mostra depois: o nome publico que o
-- profissional escolheu no diretorio, ou o nome da conta quando nao ha perfil.
create or replace function public.preview_professional_invite(p_token text)
returns table (
  invite_id uuid,
  professional_display_name text,
  council text,
  council_region text,
  registration_number text,
  specialty text,
  expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  resolved public.professional_invites%rowtype;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if public.professional_invite_attempts_exceeded(actor_id) then
    raise exception 'too many invite attempts' using errcode = '54000';
  end if;

  resolved := public.professional_invite_resolve(actor_id, p_token);
  if resolved.id is null then
    perform public.professional_invite_record_denied(actor_id);
    return;
  end if;

  if resolved.state = 'created' then
    update public.professional_invites
    set state = 'opened', opened_at = statement_timestamp()
    where id = resolved.id;
    insert into public.audit_logs (
      actor_user_id, action, entity_type, entity_id, outcome, correlation_id
    ) values (
      actor_id, 'professional_invite.opened', 'professional_invite', resolved.id,
      'success', gen_random_uuid()
    );
  end if;

  -- Somente fatos que ajudam a pessoa a decidir com quem esta se vinculando.
  return query
  select resolved.id, coalesce(public_profile.display_name, person.display_name),
         profile.council, profile.council_region, profile.registration_number,
         profile.specialty, resolved.expires_at
  from public.professional_profiles profile
  join public.profiles person on person.user_id = profile.user_id
  left join public.professional_public_profiles public_profile on public_profile.user_id = profile.user_id
  where profile.user_id = resolved.professional_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Catalogo de notificacao: `invite_accepted` (so no aplicativo por padrao)
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (
  kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice',
           'appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder',
           'session_ready', 'connection_requested', 'relationship_created',
           'professional_verification_update', 'help_request_received', 'help_request_updated',
           'invite_accepted')
);
alter table public.notifications drop constraint notifications_event_key_check;
alter table public.notifications add constraint notifications_event_key_check check (
  event_key ~ '^(checkin_reminder|goal_reminder|system_notice):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or event_key ~ '^weekly_digest:[0-9]{4}-W[0-9]{2}$'
  or event_key ~ '^appointment_(requested|confirmed|cancelled|reminder):[0-9a-f-]{36}$'
  or event_key ~ '^session_ready:[0-9a-f-]{36}$'
  or event_key ~ '^(connection_requested|relationship_created):[0-9a-f-]{36}$'
  or event_key ~ '^professional_verification_update:[0-9a-f-]{36}$'
  or event_key ~ '^help_request_(received|updated):[0-9a-f-]{36}$'
  or event_key ~ '^invite_accepted:[0-9a-f-]{36}$'
);

alter table public.notification_preferences drop constraint notification_preferences_kind_check;
alter table public.notification_preferences add constraint notification_preferences_kind_check check (
  kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice',
           'appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder',
           'session_ready', 'connection_requested', 'relationship_created',
           'professional_verification_update', 'help_request_received', 'help_request_updated',
           'invite_accepted')
);

alter table public.email_deliveries drop constraint email_deliveries_kind_check;
alter table public.email_deliveries add constraint email_deliveries_kind_check check (
  kind in ('checkin_reminder', 'goal_reminder', 'weekly_digest', 'system_notice',
           'appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_reminder',
           'session_ready', 'connection_requested', 'relationship_created',
           'professional_verification_update', 'help_request_received', 'help_request_updated',
           'invite_accepted')
);
alter table public.email_deliveries drop constraint email_deliveries_event_key_check;
alter table public.email_deliveries add constraint email_deliveries_event_key_check check (
  event_key ~ '^(checkin_reminder|goal_reminder|system_notice):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or event_key ~ '^weekly_digest:[0-9]{4}-W[0-9]{2}$'
  or event_key ~ '^appointment_(requested|confirmed|cancelled|reminder):[0-9a-f-]{36}$'
  or event_key ~ '^session_ready:[0-9a-f-]{36}$'
  or event_key ~ '^(connection_requested|relationship_created):[0-9a-f-]{36}$'
  or event_key ~ '^professional_verification_update:[0-9a-f-]{36}$'
  or event_key ~ '^help_request_(received|updated):[0-9a-f-]{36}$'
  or event_key ~ '^invite_accepted:[0-9a-f-]{36}$'
);

create or replace function public.seed_notification_preferences(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  legacy public.user_preferences%rowtype;
begin
  select * into legacy
  from public.user_preferences
  where user_id = p_user_id;

  insert into public.notification_preferences (user_id, kind, channel, enabled)
  values
    (p_user_id, 'checkin_reminder', 'in_app', coalesce(legacy.checkin_reminder, true)),
    (p_user_id, 'goal_reminder',    'in_app', coalesce(legacy.goal_reminder, true)),
    (p_user_id, 'weekly_digest',    'in_app', false),
    (p_user_id, 'system_notice',    'in_app', true),
    (p_user_id, 'checkin_reminder', 'web_push', false),
    (p_user_id, 'goal_reminder',    'web_push', false),
    (p_user_id, 'weekly_digest',    'web_push', false),
    (p_user_id, 'system_notice',    'web_push', false),
    (p_user_id, 'checkin_reminder', 'email', false),
    (p_user_id, 'goal_reminder',    'email', false),
    (p_user_id, 'weekly_digest',    'email', false),
    (p_user_id, 'system_notice',    'email', false),
    (p_user_id, 'appointment_requested', 'in_app', true),
    (p_user_id, 'appointment_confirmed', 'in_app', true),
    (p_user_id, 'appointment_cancelled', 'in_app', true),
    (p_user_id, 'appointment_reminder',  'in_app', true),
    (p_user_id, 'appointment_requested', 'web_push', false),
    (p_user_id, 'appointment_confirmed', 'web_push', false),
    (p_user_id, 'appointment_cancelled', 'web_push', false),
    (p_user_id, 'appointment_reminder',  'web_push', false),
    (p_user_id, 'appointment_requested', 'email', false),
    (p_user_id, 'appointment_confirmed', 'email', false),
    (p_user_id, 'appointment_cancelled', 'email', false),
    (p_user_id, 'appointment_reminder',  'email', false),
    (p_user_id, 'session_ready', 'in_app', true),
    (p_user_id, 'session_ready', 'web_push', false),
    (p_user_id, 'session_ready', 'email', false),
    (p_user_id, 'connection_requested', 'in_app', true),
    (p_user_id, 'connection_requested', 'web_push', false),
    (p_user_id, 'connection_requested', 'email', false),
    (p_user_id, 'relationship_created', 'in_app', true),
    (p_user_id, 'relationship_created', 'web_push', false),
    (p_user_id, 'relationship_created', 'email', false),
    (p_user_id, 'professional_verification_update', 'in_app', true),
    (p_user_id, 'professional_verification_update', 'web_push', false),
    (p_user_id, 'professional_verification_update', 'email', false),
    (p_user_id, 'help_request_received', 'in_app', true),
    (p_user_id, 'help_request_received', 'web_push', false),
    (p_user_id, 'help_request_received', 'email', false),
    (p_user_id, 'help_request_updated', 'in_app', true),
    (p_user_id, 'help_request_updated', 'web_push', false),
    (p_user_id, 'help_request_updated', 'email', false),
    (p_user_id, 'invite_accepted', 'in_app', true),
    (p_user_id, 'invite_accepted', 'web_push', false),
    (p_user_id, 'invite_accepted', 'email', false)
  on conflict (user_id, kind, channel) do nothing;
end;
$$;

-- Contas existentes ganham as linhas novas (idempotente).
select public.seed_notification_preferences(profile.user_id) from public.profiles profile;

-- ---------------------------------------------------------------------------
-- 6. Aceite com resultado explicito (L-435) e aviso ao profissional (L-433)
-- ---------------------------------------------------------------------------

/*
  Uma transacao, o mesmo ponto de serializacao do PRO-2/PRO-3:
  `for update` no convite + lock consultivo (pessoa:profissional) + `for update`
  na relationship. Resultados:
    created          vinculo novo, `active`
    activated        `pending`/`revoked`/`ended` -> `active` (grants antigos seguem revogados)
    already_active   ja estava ativo: nada muda
    already_paused   pausa decidida pelo titular: nunca retomada em silencio
    already_accepted o PROPRIO titular repete um aceite ja concluido (retry,
                     duas abas): devolve o estado atual, sem negativa. Para
                     qualquer outra pessoa o mesmo codigo e "indisponivel".
  Nenhum caminho cria `sharing_permissions`.
*/
create or replace function public.accept_professional_invite_code(p_token text)
returns table (
  connection_id uuid,
  outcome text,
  connection_status text,
  professional_display_name text,
  professional_slug text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  actor_id uuid := auth.uid();
  resolved public.professional_invites%rowtype;
  previous public.professional_invites%rowtype;
  connection public.professional_connections%rowtype;
  result text;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if public.professional_invite_attempts_exceeded(actor_id) then
    raise exception 'too many invite attempts' using errcode = '54000';
  end if;

  resolved := public.professional_invite_resolve(actor_id, p_token);
  if resolved.id is null then
    select * into previous from public.professional_invites invite
    where invite.token_digest = public.professional_invite_lookup_digest(p_token)
      and invite.state = 'accepted'
      and invite.redeemed_by_user_id = actor_id
      and invite.relationship_id is not null;
    if previous.id is null then
      perform public.professional_invite_record_denied(actor_id);
      return;
    end if;
    select * into connection from public.professional_connections
    where id = previous.relationship_id and client_user_id = actor_id;
    if connection.id is null then
      perform public.professional_invite_record_denied(actor_id);
      return;
    end if;
    result := 'already_accepted';
  else
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(actor_id::text || ':' || resolved.professional_user_id::text, 0)
    );
    select * into connection from public.professional_connections existing
    where existing.client_user_id = actor_id
      and existing.professional_user_id = resolved.professional_user_id
    for update;

    if not found then
      insert into public.professional_connections (
        client_user_id, professional_user_id, invited_by_user_id, status,
        accepted_at, origin_invite_id
      ) values (
        actor_id, resolved.professional_user_id, resolved.professional_user_id,
        'active', statement_timestamp(), resolved.id
      ) returning * into connection;
      result := 'created';
    elsif connection.status in ('pending', 'revoked', 'ended') then
      -- Reativacao nunca ressuscita grant: todo grant anterior segue revogado.
      update public.sharing_permissions
      set status = 'revoked', revoked_at = coalesce(revoked_at, statement_timestamp())
      where sharing_permissions.connection_id = connection.id and status = 'granted';
      update public.professional_connections
      set status = 'active', accepted_at = statement_timestamp(), revoked_at = null,
          ended_at = null, ended_by_user_id = null, paused_at = null,
          invited_by_user_id = resolved.professional_user_id,
          invited_at = statement_timestamp(), origin_invite_id = resolved.id
      where id = connection.id
      returning * into connection;
      result := 'activated';
    elsif connection.status = 'paused' then
      result := 'already_paused';
    else
      result := 'already_active';
    end if;

    update public.professional_invites
    set state = 'accepted', accepted_at = statement_timestamp(),
        consumed_at = statement_timestamp(), redeemed_by_user_id = actor_id,
        relationship_id = connection.id
    where id = resolved.id;

    if result in ('created', 'activated') then
      perform public.professional_trail_append(connection.id, 'relationship_created', null, 'client');
    end if;
    insert into public.audit_logs (
      actor_user_id, action, entity_type, entity_id, outcome, correlation_id
    ) values (
      actor_id, 'professional_invite.accepted', 'professional_connection', connection.id,
      'success', gen_random_uuid()
    );
    -- Aviso sem nome, sem codigo: o detalhe fica atras do login. A chave do
    -- evento e o convite, entao o mesmo aceite nunca avisa duas vezes.
    if public.notification_channel_delivers(resolved.professional_user_id, 'invite_accepted', 'in_app') then
      insert into public.notifications (user_id, kind, event_key)
      values (resolved.professional_user_id, 'invite_accepted', 'invite_accepted:' || resolved.id::text)
      on conflict (user_id, event_key) do nothing;
    end if;
  end if;

  return query
  select connection.id, result, connection.status,
         coalesce(public_profile.display_name, person.display_name),
         case when public_profile.listed
                and public.professional_verification_is_current(connection.professional_user_id)
              then public_profile.slug end
  from public.profiles person
  left join public.professional_public_profiles public_profile
    on public_profile.user_id = person.user_id
  where person.user_id = connection.professional_user_id;
end;
$$;

revoke all on function public.accept_professional_invite_code(text) from public, anon, service_role;
grant execute on function public.accept_professional_invite_code(text) to authenticated;

-- A assinatura antiga continua valida (PRO-2/PRO-3), agora pelo mesmo caminho.
create or replace function public.accept_professional_invite(p_token text)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select accepted.connection_id from public.accept_professional_invite_code(p_token) accepted limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 7. Caminho legado por UUID (L-434): sem superficie executavel
-- ---------------------------------------------------------------------------

-- A funcao fica (sem drop): historico e pgTAP da Stage 10 a referenciam. So
-- deixa de ser chamavel. O vinculo nasce pelo convite (fluxo A) ou pelo pedido
-- no diretorio (fluxo B, `request_professional_connection`).
revoke all on function public.invite_professional(uuid) from public, anon, authenticated, service_role;
