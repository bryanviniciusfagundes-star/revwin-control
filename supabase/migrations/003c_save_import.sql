-- Revwin Control — Etapa 2: função de importação atômica (tudo ou nada)
-- Cole no Supabase: SQL Editor > New query > colar > Run

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
