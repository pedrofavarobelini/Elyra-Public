-- Stage 06: Diario privado e Metas baseadas em eventos.
-- Migration estritamente aditiva. Nenhum texto do diario integra audit_logs.

-- Correcao regressiva aditiva da Stage 05: o instante padrao de um check-in
-- precisa vir do mesmo relogio que aplica a regra de futuro. Isso evita que um
-- pequeno skew entre o host Windows e o container PostgreSQL recuse um "agora"
-- legitimo. A funcao V1 permanece disponivel; a UI passa a usar esta V2, que
-- tambem devolve o instante efetivamente persistido sem leitura adicional.
create or replace function public.create_emotional_checkin_v2(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  occurred_at_value timestamptz := coalesce(
    nullif(p_payload ->> 'occurred_at', '')::timestamptz,
    statement_timestamp()
  );
  created_id uuid;
begin
  created_id := public.create_emotional_checkin(
    p_payload || jsonb_build_object('occurred_at', occurred_at_value)
  );
  return jsonb_build_object(
    'id', created_id,
    'occurred_at', occurred_at_value
  );
end;
$$;

revoke all on function public.create_emotional_checkin_v2(jsonb) from public;
grant execute on function public.create_emotional_checkin_v2(jsonb)
to authenticated, service_role;

create table public.journal_tags (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) between 1 and 30),
  origin text not null check (origin in ('system', 'custom')),
  owner_user_id uuid references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  constraint journal_tag_owner_shape check (
    (origin = 'system' and owner_user_id is null)
    or (origin = 'custom' and owner_user_id is not null)
  )
);

create unique index journal_tags_system_label_idx
  on public.journal_tags (lower(label)) where origin = 'system';
create unique index journal_tags_owner_label_idx
  on public.journal_tags (owner_user_id, lower(label)) where origin = 'custom';
create index journal_tags_owner_idx
  on public.journal_tags (owner_user_id) where owner_user_id is not null;

insert into public.journal_tags (id, label, origin, owner_user_id)
values
  ('20000000-0000-4000-8000-000000000001', 'Gratidao', 'system', null),
  ('20000000-0000-4000-8000-000000000002', 'Trabalho', 'system', null),
  ('20000000-0000-4000-8000-000000000003', 'Reflexao', 'system', null),
  ('20000000-0000-4000-8000-000000000004', 'Relacoes', 'system', null);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  title text not null default '' check (char_length(title) <= 120),
  content text not null default '',
  status text not null default 'draft' check (status in ('draft', 'saved')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  trashed_at timestamptz,
  constraint journal_entry_has_content check (
    char_length(btrim(title)) > 0 or char_length(btrim(content)) > 0
  )
);

create index journal_entries_user_active_idx
  on public.journal_entries (user_id, updated_at desc) where trashed_at is null;
create index journal_entries_user_trash_idx
  on public.journal_entries (user_id, trashed_at desc) where trashed_at is not null;

create trigger journal_entries_set_updated_at
before update on public.journal_entries
for each row execute function public.set_updated_at();

create table public.journal_entry_tags (
  entry_id uuid not null references public.journal_entries(id) on delete cascade,
  tag_id uuid not null references public.journal_tags(id) on delete restrict,
  primary key (entry_id, tag_id)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  kind text not null check (kind in ('frequency', 'quantitative')),
  status text not null default 'active'
    check (status in ('active', 'completed', 'paused', 'cancelled')),
  recurrence text not null check (recurrence in ('daily', 'weekly')),
  target integer not null check (target >= 1),
  unit text check (unit is null or char_length(unit) <= 12),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index goals_user_status_idx
  on public.goals (user_id, status, created_at desc);

create trigger goals_set_updated_at
before update on public.goals
for each row execute function public.set_updated_at();

create table public.goal_progress_entries (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  occurred_on date not null default current_date,
  amount integer not null check (amount >= 1),
  created_at timestamptz not null default timezone('utc', now())
);

create index goal_progress_goal_day_idx
  on public.goal_progress_entries (goal_id, occurred_on desc, created_at desc);

create or replace function public.reject_inactive_goal_progress()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.occurred_on > current_date then
    raise exception 'future goal progress is not allowed'
      using errcode = '22007';
  end if;
  if not exists (
    select 1 from public.goals
    where id = new.goal_id and status = 'active'
  ) then
    raise exception 'progress requires an active owned goal'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger goal_progress_requires_active_goal
before insert on public.goal_progress_entries
for each row execute function public.reject_inactive_goal_progress();

alter table public.journal_tags enable row level security;
alter table public.journal_tags force row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_entries force row level security;
alter table public.journal_entry_tags enable row level security;
alter table public.journal_entry_tags force row level security;
alter table public.goals enable row level security;
alter table public.goals force row level security;
alter table public.goal_progress_entries enable row level security;
alter table public.goal_progress_entries force row level security;

revoke all on table public.journal_tags from anon, authenticated;
revoke all on table public.journal_entries from anon, authenticated;
revoke all on table public.journal_entry_tags from anon, authenticated;
revoke all on table public.goals from anon, authenticated;
revoke all on table public.goal_progress_entries from anon, authenticated;

grant select, insert on table public.journal_tags to authenticated;
grant select, insert, update, delete on table public.journal_entries to authenticated;
grant select, insert, delete on table public.journal_entry_tags to authenticated;
grant select, insert, update, delete on table public.goals to authenticated;
grant select, insert, delete on table public.goal_progress_entries to authenticated;
grant all on table public.journal_tags to service_role;
grant all on table public.journal_entries to service_role;
grant all on table public.journal_entry_tags to service_role;
grant all on table public.goals to service_role;
grant all on table public.goal_progress_entries to service_role;

create policy journal_tags_select_visible
on public.journal_tags for select to authenticated
using (origin = 'system' or (select auth.uid()) = owner_user_id);
create policy journal_tags_insert_custom_own
on public.journal_tags for insert to authenticated
with check (origin = 'custom' and (select auth.uid()) = owner_user_id);

create policy journal_entries_select_own
on public.journal_entries for select to authenticated
using ((select auth.uid()) = user_id);
create policy journal_entries_insert_own
on public.journal_entries for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy journal_entries_update_own
on public.journal_entries for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy journal_entries_delete_own
on public.journal_entries for delete to authenticated
using ((select auth.uid()) = user_id);

create policy journal_entry_tags_select_own
on public.journal_entry_tags for select to authenticated
using (
  exists (
    select 1 from public.journal_entries entry
    where entry.id = entry_id and entry.user_id = (select auth.uid())
  )
);
create policy journal_entry_tags_insert_own_visible
on public.journal_entry_tags for insert to authenticated
with check (
  exists (
    select 1 from public.journal_entries entry
    where entry.id = entry_id and entry.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.journal_tags tag
    where tag.id = tag_id
      and (tag.origin = 'system' or tag.owner_user_id = (select auth.uid()))
  )
);
create policy journal_entry_tags_delete_own
on public.journal_entry_tags for delete to authenticated
using (
  exists (
    select 1 from public.journal_entries entry
    where entry.id = entry_id and entry.user_id = (select auth.uid())
  )
);

create policy goals_select_own
on public.goals for select to authenticated
using ((select auth.uid()) = user_id);
create policy goals_insert_own
on public.goals for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy goals_update_own
on public.goals for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy goals_delete_own
on public.goals for delete to authenticated
using ((select auth.uid()) = user_id);

create policy goal_progress_select_own
on public.goal_progress_entries for select to authenticated
using (
  exists (
    select 1 from public.goals goal
    where goal.id = goal_id and goal.user_id = (select auth.uid())
  )
);
create policy goal_progress_insert_own
on public.goal_progress_entries for insert to authenticated
with check (
  exists (
    select 1 from public.goals goal
    where goal.id = goal_id and goal.user_id = (select auth.uid())
  )
);
create policy goal_progress_delete_own
on public.goal_progress_entries for delete to authenticated
using (
  exists (
    select 1 from public.goals goal
    where goal.id = goal_id and goal.user_id = (select auth.uid())
  )
);

create or replace function public.save_journal_entry(p_payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_id uuid := coalesce(
    nullif(p_payload ->> 'id', '')::uuid,
    gen_random_uuid()
  );
  requested_id uuid := nullif(p_payload ->> 'id', '')::uuid;
begin
  if jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(coalesce(p_payload -> 'tag_ids', '[]'::jsonb)) <> 'array' then
    raise exception 'invalid journal payload' using errcode = '22023';
  end if;

  if requested_id is null then
    insert into public.journal_entries (
      id, user_id, title, content, status
    ) values (
      saved_id,
      (select auth.uid()),
      coalesce(p_payload ->> 'title', ''),
      coalesce(p_payload ->> 'content', ''),
      coalesce(p_payload ->> 'status', 'draft')
    );
  else
    insert into public.journal_entries (
      id, user_id, title, content, status
    ) values (
      saved_id,
      (select auth.uid()),
      coalesce(p_payload ->> 'title', ''),
      coalesce(p_payload ->> 'content', ''),
      coalesce(p_payload ->> 'status', 'draft')
    )
    on conflict (id) do update set
      title = excluded.title,
      content = excluded.content,
      status = excluded.status
    where journal_entries.user_id = (select auth.uid())
      and journal_entries.trashed_at is null;

    if not found then
      raise exception 'journal entry is unavailable' using errcode = '42501';
    end if;
  end if;

  delete from public.journal_entry_tags where entry_id = saved_id;
  insert into public.journal_entry_tags (entry_id, tag_id)
  select saved_id, selected.tag_id::uuid
  from (
    select distinct jsonb_array_elements_text(
      coalesce(p_payload -> 'tag_ids', '[]'::jsonb)
    ) as tag_id
  ) selected;

  return saved_id;
end;
$$;

create or replace function public.purge_expired_journal_entries()
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  purged_count bigint;
begin
  delete from public.journal_entries
  where user_id = (select auth.uid())
    and trashed_at is not null
    and trashed_at <= statement_timestamp() - interval '30 days';
  get diagnostics purged_count = row_count;
  return purged_count;
end;
$$;

revoke all on function public.save_journal_entry(jsonb) from public;
revoke all on function public.purge_expired_journal_entries() from public;
grant execute on function public.save_journal_entry(jsonb)
to authenticated, service_role;
grant execute on function public.purge_expired_journal_entries()
to authenticated, service_role;

create or replace function public.audit_stage06_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  row_id uuid;
  action_name text;
  entity_name text;
begin
  if tg_op = 'DELETE' then
    row_id := old.id;
  else
    row_id := new.id;
  end if;

  if actor_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  entity_name := case tg_table_name
    when 'journal_entries' then 'journal_entry'
    when 'journal_tags' then 'journal_tag'
    when 'goals' then 'goal'
    when 'goal_progress_entries' then 'goal_progress_entry'
  end;

  action_name := case tg_table_name
    when 'journal_entries' then
      case
        when tg_op = 'INSERT' then 'journal_entry.created'
        when tg_op = 'DELETE' then 'journal_entry.deleted'
        when (to_jsonb(old) ->> 'trashed_at') is null
          and (to_jsonb(new) ->> 'trashed_at') is not null
          then 'journal_entry.trashed'
        when (to_jsonb(old) ->> 'trashed_at') is not null
          and (to_jsonb(new) ->> 'trashed_at') is null
          then 'journal_entry.restored'
        else 'journal_entry.updated'
      end
    when 'journal_tags' then 'journal_tag.created'
    when 'goals' then
      case
        when tg_op = 'INSERT' then 'goal.created'
        when tg_op = 'DELETE' then 'goal.deleted'
        else 'goal.updated'
      end
    when 'goal_progress_entries' then
      case when tg_op = 'INSERT' then 'goal_progress.created' else 'goal_progress.deleted' end
  end;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, outcome, correlation_id
  ) values (
    actor_id, action_name, entity_name, row_id, 'success', gen_random_uuid()
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger journal_entries_audit_write
after insert or update or delete on public.journal_entries
for each row execute function public.audit_stage06_write();
create trigger journal_tags_audit_insert
after insert on public.journal_tags
for each row execute function public.audit_stage06_write();
create trigger goals_audit_write
after insert or update or delete on public.goals
for each row execute function public.audit_stage06_write();
create trigger goal_progress_audit_write
after insert or delete on public.goal_progress_entries
for each row execute function public.audit_stage06_write();
