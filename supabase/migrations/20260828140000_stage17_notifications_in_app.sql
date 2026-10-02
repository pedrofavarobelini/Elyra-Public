-- Stage 17-N: notificacoes in-app V1.
--
-- Migration estritamente aditiva. A V1 materializa somente os dois lembretes
-- ja nomeados por `user_preferences`: check-in e metas. Nenhum texto livre
-- entra nesta tabela; a copia exibida vem do vocabulary fechado da aplicacao.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  kind text not null
    check (kind in ('checkin_reminder', 'goal_reminder')),
  event_key text not null
    check (
      event_key ~ '^(checkin_reminder|goal_reminder):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    ),
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint notifications_user_event_unique unique (user_id, event_key),
  constraint notifications_event_kind_match check (
    split_part(event_key, ':', 1) = kind
  )
);

create index notifications_user_time_idx
on public.notifications (user_id, created_at desc);

create index notifications_user_unread_idx
on public.notifications (user_id, created_at desc)
where read_at is null;

comment on table public.notifications is
  'Lembretes in-app V1, owner-only, sem texto livre e eliminados com a conta.';

alter table public.notifications enable row level security;
alter table public.notifications force row level security;

revoke all on table public.notifications from anon, authenticated;
grant select on table public.notifications to authenticated;
grant all on table public.notifications to service_role;

create policy notifications_select_own
on public.notifications for select to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.materialize_in_app_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  preferences public.user_preferences%rowtype;
  current_day date := current_date;
  created_id uuid;
  created_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into preferences
  from public.user_preferences
  where user_id = current_user_id;

  if not found then
    raise exception 'preferences not found' using errcode = 'P0002';
  end if;

  if preferences.checkin_reminder
    and not exists (
      select 1
      from public.emotional_checkins checkin
      where checkin.user_id = current_user_id
        and (checkin.occurred_at at time zone 'UTC')::date = current_day
    ) then
    created_id := null;
    insert into public.notifications (user_id, kind, event_key)
    values (
      current_user_id,
      'checkin_reminder',
      'checkin_reminder:' || to_char(current_day, 'YYYY-MM-DD')
    )
    on conflict (user_id, event_key) do nothing
    returning id into created_id;

    if created_id is not null then
      created_count := created_count + 1;
      insert into public.audit_logs (
        actor_user_id, action, entity_type, entity_id, outcome, correlation_id
      ) values (
        current_user_id, 'notification.created', 'notification', created_id,
        'success', gen_random_uuid()
      );
    end if;
  end if;

  if preferences.goal_reminder
    and exists (
      select 1
      from public.goals goal
      where goal.user_id = current_user_id
        and goal.status = 'active'
    ) then
    created_id := null;
    insert into public.notifications (user_id, kind, event_key)
    values (
      current_user_id,
      'goal_reminder',
      'goal_reminder:' || to_char(current_day, 'YYYY-MM-DD')
    )
    on conflict (user_id, event_key) do nothing
    returning id into created_id;

    if created_id is not null then
      created_count := created_count + 1;
      insert into public.audit_logs (
        actor_user_id, action, entity_type, entity_id, outcome, correlation_id
      ) values (
        current_user_id, 'notification.created', 'notification', created_id,
        'success', gen_random_uuid()
      );
    end if;
  end if;

  return created_count;
end;
$$;

revoke all on function public.materialize_in_app_notifications()
from public, anon, service_role;
grant execute on function public.materialize_in_app_notifications()
to authenticated;

create or replace function public.mark_in_app_notification_read(
  p_notification_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  owned_id uuid;
  previous_read_at timestamptz;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select id, read_at into owned_id, previous_read_at
  from public.notifications
  where id = p_notification_id
    and user_id = current_user_id;

  if not found then
    return null;
  end if;

  if previous_read_at is null then
    update public.notifications
    set read_at = timezone('utc', now())
    where id = owned_id;

    insert into public.audit_logs (
      actor_user_id, action, entity_type, entity_id, outcome, correlation_id
    ) values (
      current_user_id, 'notification.read', 'notification', owned_id,
      'success', gen_random_uuid()
    );
  end if;

  return owned_id;
end;
$$;

revoke all on function public.mark_in_app_notification_read(uuid)
from public, anon, service_role;
grant execute on function public.mark_in_app_notification_read(uuid)
to authenticated;
