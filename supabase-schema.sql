-- Our Recipes v0.2
-- Run this entire file once in your Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Our Recipes',
  join_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null,
  prep_minutes int check (prep_minutes is null or prep_minutes >= 0),
  cook_minutes int check (cook_minutes is null or cook_minutes >= 0),
  ingredients jsonb not null default '[]'::jsonb,
  instructions jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  notes text,
  source_url text,
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recipes_household_created_idx
  on public.recipes (household_id, created_at desc);

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.recipes enable row level security;

-- Recreate policies safely if you rerun this file.
drop policy if exists "members can read household" on public.households;
drop policy if exists "members can read memberships" on public.household_members;
drop policy if exists "members can read recipes" on public.recipes;
drop policy if exists "members can insert recipes" on public.recipes;
drop policy if exists "members can update recipes" on public.recipes;
drop policy if exists "members can delete recipes" on public.recipes;

create policy "members can read household" on public.households
for select to authenticated
using (
  exists (
    select 1 from public.household_members m
    where m.household_id = households.id and m.user_id = auth.uid()
  )
);

create policy "members can read memberships" on public.household_members
for select to authenticated
using (user_id = auth.uid());

create policy "members can read recipes" on public.recipes
for select to authenticated
using (
  exists (
    select 1 from public.household_members m
    where m.household_id = recipes.household_id and m.user_id = auth.uid()
  )
);

create policy "members can insert recipes" on public.recipes
for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.household_members m
    where m.household_id = recipes.household_id and m.user_id = auth.uid()
  )
);

create policy "members can update recipes" on public.recipes
for update to authenticated
using (
  exists (
    select 1 from public.household_members m
    where m.household_id = recipes.household_id and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.household_members m
    where m.household_id = recipes.household_id and m.user_id = auth.uid()
  )
);

create policy "members can delete recipes" on public.recipes
for delete to authenticated
using (
  exists (
    select 1 from public.household_members m
    where m.household_id = recipes.household_id and m.user_id = auth.uid()
  )
);

-- Secure helper to create a household and automatically make the caller owner.
create or replace function public.create_household(p_name text default 'Our Recipes')
returns table (household_id uuid, join_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_household public.households%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  insert into public.households(name, created_by)
  values (coalesce(nullif(trim(p_name), ''), 'Our Recipes'), auth.uid())
  returning * into new_household;

  insert into public.household_members(household_id, user_id, role)
  values (new_household.id, auth.uid(), 'owner');

  return query select new_household.id, new_household.join_code;
end;
$$;

-- Secure helper to join from another phone using the 8-character code.
create or replace function public.join_household(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  select h.id into target_id
  from public.households h
  where h.join_code = upper(trim(p_code));

  if target_id is null then
    raise exception 'That cookbook code was not found.';
  end if;

  insert into public.household_members(household_id, user_id, role)
  values (target_id, auth.uid(), 'member')
  on conflict (household_id, user_id) do nothing;

  return target_id;
end;
$$;

revoke all on function public.create_household(text) from public;
revoke all on function public.join_household(text) from public;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.join_household(text) to authenticated;

create or replace function public.touch_recipe_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists recipes_touch_updated_at on public.recipes;
create trigger recipes_touch_updated_at
before update on public.recipes
for each row execute procedure public.touch_recipe_updated_at();
