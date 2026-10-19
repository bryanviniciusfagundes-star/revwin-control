-- ============================================================
-- Revwin Control — Etapa 3
-- Conferências salvas (uma por período de casa) e configurações.
-- ============================================================

-- ---------- Configurações (tolerância de divergência) ----------
create table public.app_settings (
  user_id        uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  tolerance_usd  numeric(10,2) not null default 1.00 check (tolerance_usd >= 0),
  updated_at     timestamptz not null default now()
);
alter table public.app_settings enable row level security;
create policy own_rows on public.app_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------- Conferências ----------
-- summary: contagens; items: tabela jogador a jogador (para consulta e exportação).
-- Guarda quais importações foram usadas: se uma delas for trocada, a conferência fica desatualizada.
create table public.reconciliations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_id        uuid not null unique references public.periods(id) on delete cascade,
  ia_import_id     uuid references public.imports(id) on delete set null,
  house_import_id  uuid references public.imports(id) on delete set null,
  tolerance_usd    numeric(10,2) not null check (tolerance_usd >= 0),
  rates            jsonb not null default '{}',
  summary          jsonb not null,
  items            jsonb not null,
  qftd             integer check (qftd >= 0),
  baseline_count   integer check (baseline_count >= 0),
  divergences      integer not null check (divergences >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index reconciliations_ia_idx on public.reconciliations (ia_import_id);
create index reconciliations_house_idx on public.reconciliations (house_import_id);
create trigger reconciliations_touch before update on public.reconciliations
for each row execute function public.touch_updated_at();

alter table public.reconciliations enable row level security;
create policy own_rows on public.reconciliations for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Salva (ou refaz) a conferência do período e grava o QFTD no período.
create or replace function public.save_reconciliation(
  p_period_id       uuid,
  p_ia_import_id    uuid,
  p_house_import_id uuid,
  p_tolerance       numeric,
  p_rates           jsonb,
  p_summary         jsonb,
  p_items           jsonb,
  p_qftd            integer,
  p_baseline_count  integer,
  p_divergences     integer
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.reconciliations (period_id, ia_import_id, house_import_id, tolerance_usd, rates, summary, items,
                                      qftd, baseline_count, divergences)
  values (p_period_id, p_ia_import_id, p_house_import_id, p_tolerance, coalesce(p_rates, '{}'::jsonb), p_summary, p_items,
          p_qftd, p_baseline_count, p_divergences)
  on conflict (period_id) do update set
    ia_import_id = excluded.ia_import_id, house_import_id = excluded.house_import_id,
    tolerance_usd = excluded.tolerance_usd, rates = excluded.rates, summary = excluded.summary,
    items = excluded.items, qftd = excluded.qftd, baseline_count = excluded.baseline_count,
    divergences = excluded.divergences
  returning id into v_id;

  update public.periods set qftd = p_qftd where id = p_period_id;
  return v_id;
end $$;

revoke all on function public.save_reconciliation(uuid,uuid,uuid,numeric,jsonb,jsonb,jsonb,integer,integer,integer) from public, anon;
grant execute on function public.save_reconciliation(uuid,uuid,uuid,numeric,jsonb,jsonb,jsonb,integer,integer,integer) to authenticated;

-- Ao excluir/substituir a importação da casa, o QFTD calculado deixa de valer.
create or replace function public.clear_import_indicators()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.source = 'ia' then
    update public.periods set ftd_ia = null where id = old.period_id;
  else
    update public.periods set ftd_panel = null, deposits_sum_usd = null, qftd = null where id = old.period_id;
  end if;
  return old;
end $$;
