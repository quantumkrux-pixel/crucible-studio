-- Crucible3D backend schema + Row Level Security.
--
-- Security model (enforced in the DATABASE, not the UI):
--   * profiles.licensed is the single source of truth for "has paid".
--     It is written ONLY by the Stripe webhook (service_role), never by
--     the client — there is no client UPDATE policy that can set it.
--   * projects RLS lets a user read/update/delete only their own rows,
--     and INSERT is capped at 1 project UNLESS the user is licensed.
--   * Exports are gated server-side by an Edge Function that checks
--     licensed before returning data (see functions/), so the limit
--     can't be bypassed by editing frontend JS.
--
-- Apply with:  supabase db push   (or paste into the SQL editor)

-- ----------------------------------------------------------------------
-- profiles: one row per auth user; mirrors auth.users, holds license.
-- ----------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  licensed     boolean not null default false,
  license_source text,                       -- e.g. 'stripe'
  stripe_customer_id text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Users may READ their own profile (to see licensed status)...
create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using ( auth.uid() = id );

-- ...but there is deliberately NO insert/update/delete policy for
-- authenticated users. Only service_role (webhook) writes licensed.
-- A trigger creates the row on signup (runs as definer, bypassing RLS).

-- Auto-create a profile row when a new auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------
-- projects: the user's saved scenes (migrated off IndexedDB).
-- ----------------------------------------------------------------------
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null default 'Untitled',
  data        jsonb not null,               -- the SceneStore JSON payload
  thumbnail   text,                         -- data URL preview (optional)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists projects_user_id_idx on public.projects(user_id);

alter table public.projects enable row level security;

-- Read your own projects.
create policy "projects: read own"
  on public.projects for select
  to authenticated
  using ( auth.uid() = user_id );

-- Update your own projects.
create policy "projects: update own"
  on public.projects for update
  to authenticated
  using ( auth.uid() = user_id )
  with check ( auth.uid() = user_id );

-- Delete your own projects.
create policy "projects: delete own"
  on public.projects for delete
  to authenticated
  using ( auth.uid() = user_id );

-- INSERT: must own the row, AND either be licensed or currently have
-- fewer than 1 project. This is the "1 free project" cap, enforced in
-- the database so it can't be bypassed from the client.
create policy "projects: insert with free-tier cap"
  on public.projects for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and (
      (select licensed from public.profiles where id = auth.uid())
      or (select count(*) from public.projects where user_id = auth.uid()) < 1
    )
  );

-- keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();
