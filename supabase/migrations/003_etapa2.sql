-- ============================================================
-- Revwin Control — Etapa 2
-- Campo SendPulse, importações de CSV e registros individuais.
-- ============================================================

-- ---------- Depósitos confirmados no SendPulse (manual) ----------
alter table public.periods
  add column sendpulse_deposits integer check (sendpulse_deposits >= 0);

-- ---------- Importações ----------
-- Uma importação por fonte (IA ou casa) em cada período.
-- O arquivo original fica guardado em raw_content.
create table public.imports (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_id       uuid not null references public.periods(id) on delete restrict,
  source          text not null check (source in ('ia','house')),
  file_name       text not null,
  file_hash       text not null,               -- SHA-256 do arquivo: impede reimportar o mesmo arquivo
  raw_content     text not null,               -- conteúdo original preservado
  mapping         jsonb not null,              -- colunas escolhidas + opções de leitura (reutilizado)
  deposit_kind    text not null check (deposit_kind in ('first','total')),
  currency_rates  jsonb not null default '{}', -- taxas manuais: quantas unidades valem 1 USD
  row_count       integer not null check (row_count >= 0),
  player_count    integer not null check (player_count >= 0),
  created_at      timestamptz not null default now(),
  constraint imports_one_per_source unique (period_id, source)
);
create unique index imports_hash_uq on public.imports (user_id, file_hash);

-- ---------- Registros individuais (1 linha por jogador por importação) ----------
create table public.player_records (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  import_id         uuid not null references public.imports(id) on delete cascade,
  period_id         uuid not null references public.periods(id) on delete restrict,
  source            text not null check (source in ('ia','house')),
  player_id         text not null check (length(trim(player_id)) > 0),
  deposit_amount    numeric(14,2),   -- na moeda original; NULL = não informado
  deposit_currency  text,
  deposit_usd       numeric(14,2),   -- NULL quando não há taxa confiável
  deposit_count     integer not null default 0 check (deposit_count >= 0),
  bets_amount       numeric(14,2),
  bets_usd          numeric(14,2),
  event_date        date,
  status            text,
  raw               jsonb not null,  -- linha(s) originais do CSV
  constraint player_records_unique_player unique (import_id, player_id)
);
create index player_records_lookup_idx on public.player_records (period_id, source, player_id);
create index imports_period_idx on public.imports (period_id);

alter table public.imports        enable row level security;
alter table public.player_records enable row level security;
create policy own_rows on public.imports        for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_rows on public.player_records for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------- Ao excluir uma importação, limpa os indicadores que ela preencheu ----------
create or replace function public.clear_import_indicators()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.source = 'ia' then
    update public.periods set ftd_ia = null where id = old.period_id;
  else
    update public.periods set ftd_panel = null, deposits_sum_usd = null where id = old.period_id;
  end if;
  return old;
end $$;

create trigger imports_clear_indicators after delete on public.imports
for each row execute function public.clear_import_indicators();

-- ---------- Importação atômica: tudo ou nada ----------
create or replace function public.save_import(
  p_operation_id uuid,
  p_house_id     uuid,
  p_start        date,
  p_end          date,
  p_source       text,
  p_file_name    text,
  p_file_hash    text,
  p_raw          text,
  p_mapping      jsonb,
  p_deposit_kind text,
  p_rates        jsonb,
  p_row_count    integer,
  p_records      jsonb,
  p_replace      boolean default false
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_period   uuid;
  v_existing uuid;
  v_import   uuid;
begin
  -- período: usa o existente com as mesmas datas ou cria um novo
  -- (período sobreposto com outras datas é recusado pela constraint)
  select id into v_period from public.periods
   where operation_id = p_operation_id and house_id = p_house_id
     and start_date = p_start and end_date = p_end;
  if v_period is null then
    insert into public.periods (operation_id, house_id, start_date, end_date)
    values (p_operation_id, p_house_id, p_start, p_end)
    returning id into v_period;
  end if;

  select id into v_existing from public.imports where period_id = v_period and source = p_source;
  if v_existing is not null then
    if not p_replace then
      raise exception using errcode = 'RV001', message = 'Já existe uma importação desta fonte para este período.';
    end if;
    delete from public.imports where id = v_existing;
  end if;

  if exists (select 1 from public.imports where file_hash = p_file_hash) then
    raise exception using errcode = 'RV002', message = 'Este arquivo já foi importado em outro período.';
  end if;

  insert into public.imports (period_id, source, file_name, file_hash, raw_content, mapping,
                              deposit_kind, currency_rates, row_count, player_count)
  values (v_period, p_source, p_file_name, p_file_hash, p_raw, p_mapping,
          p_deposit_kind, coalesce(p_rates, '{}'::jsonb), p_row_count, jsonb_array_length(p_records))
  returning id into v_import;

  insert into public.player_records (import_id, period_id, source, player_id, deposit_amount, deposit_currency,
                                     deposit_usd, deposit_count, bets_amount, bets_usd, event_date, status, raw)
  select v_import, v_period, p_source, trim(r.player_id), r.deposit_amount, r.deposit_currency,
         r.deposit_usd, coalesce(r.deposit_count, 0), r.bets_amount, r.bets_usd, r.event_date, r.status, r.raw
    from jsonb_to_recordset(p_records) as r(
      player_id text, deposit_amount numeric, deposit_currency text, deposit_usd numeric,
      deposit_count integer, bets_amount numeric, bets_usd numeric, event_date date, status text, raw jsonb);

  -- indicadores automáticos do período
  -- FTD = jogadores com depósito > 0. Soma de depósitos vem do painel da casa,
  -- e fica vazia se algum depósito não tiver conversão para USD.
  if p_source = 'ia' then
    update public.periods
       set ftd_ia = (select count(*) from public.player_records where import_id = v_import and deposit_amount > 0)
     where id = v_period;
  else
    update public.periods
       set ftd_panel = (select count(*) from public.player_records where import_id = v_import and deposit_amount > 0),
           deposits_sum_usd = (
             select case when count(*) filter (where deposit_amount is not null and deposit_usd is null) > 0 then null
                         else sum(deposit_usd) end
               from public.player_records where import_id = v_import)
     where id = v_period;
  end if;

  return v_period;
end $$;

revoke all on function public.save_import(uuid,uuid,date,date,text,text,text,text,jsonb,text,jsonb,integer,jsonb,boolean) from public, anon;
grant execute on function public.save_import(uuid,uuid,date,date,text,text,text,text,jsonb,text,jsonb,integer,jsonb,boolean) to authenticated;
