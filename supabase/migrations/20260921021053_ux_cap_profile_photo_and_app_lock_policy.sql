-- Stage 28-R / Gate UX-CAP — prazo configuravel do App Lock e foto privada.
-- Migration somente aditiva: preserva PINs, sessoes e perfis existentes.

alter table public.app_lock_sessions
  add column if not exists idle_policy text not null default '5m';

alter table public.app_lock_sessions
  add constraint app_lock_sessions_idle_policy_check
  check (idle_policy in ('1m', '5m', '15m', '30m', 'never'));

comment on column public.app_lock_sessions.idle_policy is
  'Prazo de inatividade deste App Lock. never remove apenas o bloqueio automatico; logout e lock manual continuam.';

alter table public.profiles
  add column if not exists avatar_path text;

alter table public.profiles
  add constraint profiles_avatar_path_owner_check
  check (
    avatar_path is null
    or (
      char_length(avatar_path) between 1 and 180
      and avatar_path like user_id::text || '/profile/%'
      and avatar_path ~ '/profile/[0-9a-f-]{36}\.webp$'
    )
  );

comment on column public.profiles.avatar_path is
  'Caminho privado no bucket elyra-private. A UI usa uma rota autenticada, nunca URL publica.';
