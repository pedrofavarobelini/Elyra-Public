-- Stage 28-R / Gate S2 — App Lock local associado à sessão Supabase real.
-- Migration aditiva: nenhuma tabela, coluna ou dado existente é removido.

create table if not exists public.app_lock_sessions (
  user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  session_id uuid not null,
  lock_id uuid not null unique,
  state text not null check (state in ('LOCKED', 'UNLOCKED')),
  pin_salt text not null,
  pin_verifier text not null,
  kdf_version smallint not null default 1 check (kdf_version = 1),
  scrypt_n integer not null default 32768 check (scrypt_n = 32768),
  scrypt_r integer not null default 8 check (scrypt_r = 8),
  scrypt_p integer not null default 1 check (scrypt_p = 1),
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  cooldown_until timestamptz,
  unlocked_until timestamptz,
  last_activity_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, session_id)
);

comment on table public.app_lock_sessions is
  'Verificador App Lock por usuário e sessão Auth. Nunca contém o PIN.';
comment on column public.app_lock_sessions.session_id is
  'Claim session_id verificada pelo Supabase Auth; separa aparelhos/sessões.';
comment on column public.app_lock_sessions.pin_verifier is
  'Saída scrypt base64. Não é PIN nem material reversível.';

create index if not exists app_lock_sessions_user_idx
  on public.app_lock_sessions (user_id);
create index if not exists app_lock_sessions_expiry_idx
  on public.app_lock_sessions (unlocked_until)
  where state = 'UNLOCKED';

create trigger app_lock_sessions_set_updated_at
before update on public.app_lock_sessions
for each row execute function public.set_updated_at();

alter table public.app_lock_sessions enable row level security;
alter table public.app_lock_sessions force row level security;

revoke all on table public.app_lock_sessions from anon, authenticated;
grant select, insert, update, delete on table public.app_lock_sessions to authenticated;
grant all on table public.app_lock_sessions to service_role;

create policy app_lock_sessions_select_current
on public.app_lock_sessions for select to authenticated
using (
  (select auth.uid()) = user_id
  and session_id::text = (select auth.jwt() ->> 'session_id')
);

create policy app_lock_sessions_insert_current
on public.app_lock_sessions for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and session_id::text = (select auth.jwt() ->> 'session_id')
);

create policy app_lock_sessions_update_current
on public.app_lock_sessions for update to authenticated
using (
  (select auth.uid()) = user_id
  and session_id::text = (select auth.jwt() ->> 'session_id')
)
with check (
  (select auth.uid()) = user_id
  and session_id::text = (select auth.jwt() ->> 'session_id')
);

create policy app_lock_sessions_delete_current
on public.app_lock_sessions for delete to authenticated
using (
  (select auth.uid()) = user_id
  and session_id::text = (select auth.jwt() ->> 'session_id')
);
