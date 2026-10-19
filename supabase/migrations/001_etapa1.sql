-- ============================================================
-- Revwin Control — Etapa 1
-- Operações, casas, vínculo operação↔casa e períodos.
-- Rode uma vez no Supabase: SQL Editor > New query > colar > Run.
-- ============================================================

create extension if not exists btree_gist with schema extensions;

-- ---------- Operações ----------
create table public.operations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  expert        text,
  geo           text not null check (length(trim(geo)) > 0),
  baseline_usd  numeric(12,2) not null check (baseline_usd >= 0),
  cpa_usd       numeric(12,2) not null check (cpa_usd >= 0),
  status        text not null default 'ativa' check (status in ('ativa','pausada','encerrada')),
  created_at    timestamptz not null default now()
);
create unique index operations_user_name_uq on public.operations (user_id, lower(name));

-- ---------- Casas ----------
create table public.houses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  created_at  timestamptz not null default now()
);
create unique index houses_user_name_uq on public.houses (user_id, lower(name));

-- ---------- Vínculo operação ↔ casa (uma operação pode ter várias casas) ----------
create table public.operation_houses (
  operation_id  uuid not null references public.operations(id) on delete cascade,
  house_id      uuid not null references public.houses(id) on delete restrict,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  primary key (operation_id, house_id)
);

-- ---------- Períodos (indicadores manuais + consolidados) ----------
-- Campos vazios ficam NULL (nunca 0). Os campos marcados "importação"
-- serão preenchidos automaticamente nas Etapas 2 e 3.
create table public.periods (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  operation_id       uuid not null references public.operations(id) on delete restrict,
  house_id           uuid not null references public.houses(id) on delete restrict,
  start_date         date not null,
  end_date           date not null,

  -- manuais
  leads              integer check (leads >= 0),
  reached_pitch      integer check (reached_pitch >= 0),
  accessed_channel   integer check (accessed_channel >= 0),
  total_revenue_usd  numeric(14,2),
  notes              text,

  -- importação (Etapas 2/3)
  registrations      integer check (registrations >= 0),
  ftd_ia             integer check (ftd_ia >= 0),
  ftd_panel          integer check (ftd_panel >= 0),
  qftd               integer check (qftd >= 0),
  deposits_sum_usd   numeric(14,2),

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint periods_dates_ck check (end_date >= start_date),
  -- impede períodos sobrepostos para a mesma operação + casa
  constraint periods_no_overlap exclude using gist (
    operation_id with =,
    house_id with =,
    daterange(start_date, end_date, '[]') with &&
  )
);
create index periods_dates_idx on public.periods (start_date, end_date);
create index periods_operation_idx on public.periods (operation_id);
create index periods_house_idx on public.periods (house_id);
create index operation_houses_house_idx on public.operation_houses (house_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

create trigger periods_touch before update on public.periods
for each row execute function public.touch_updated_at();

-- ---------- Segurança (RLS): cada linha só é visível para o dono ----------
alter table public.operations        enable row level security;
alter table public.houses            enable row level security;
alter table public.operation_houses  enable row level security;
alter table public.periods           enable row level security;

create policy own_rows on public.operations       for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_rows on public.houses           for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_rows on public.operation_houses for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_rows on public.periods          for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
