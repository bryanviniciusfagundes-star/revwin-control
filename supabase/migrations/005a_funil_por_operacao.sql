-- ============================================================
-- Revwin Control — Funil por operação
-- Leads, pitch, canal e SendPulse não se separam por casa:
-- passam a ser registrados por OPERAÇÃO + período.
-- Dados de casa (CSV, FTD, depósitos, faturado) continuam em periods.
-- ============================================================

create table public.funnel_periods (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  operation_id        uuid not null references public.operations(id) on delete restrict,
  start_date          date not null,
  end_date            date not null,
  leads               integer check (leads >= 0),
  reached_pitch       integer check (reached_pitch >= 0),
  accessed_channel    integer check (accessed_channel >= 0),
  sendpulse_deposits  integer check (sendpulse_deposits >= 0),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint funnel_dates_ck check (end_date >= start_date),
  constraint funnel_no_overlap exclude using gist (
    operation_id with =,
    daterange(start_date, end_date, '[]') with &&
  )
);
create index funnel_periods_dates_idx on public.funnel_periods (start_date, end_date);

create trigger funnel_periods_touch before update on public.funnel_periods
for each row execute function public.touch_updated_at();

alter table public.funnel_periods enable row level security;
create policy own_rows on public.funnel_periods for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Migra os dados manuais que estavam por casa (soma as casas do mesmo período)
insert into public.funnel_periods (user_id, operation_id, start_date, end_date, leads, reached_pitch, accessed_channel, sendpulse_deposits, notes)
select p.user_id, p.operation_id, p.start_date, p.end_date,
       sum(p.leads), sum(p.reached_pitch), sum(p.accessed_channel), sum(p.sendpulse_deposits),
       string_agg(p.notes, E'\n')
  from public.periods p
 where p.leads is not null or p.reached_pitch is not null or p.accessed_channel is not null
    or p.sendpulse_deposits is not null or p.notes is not null
 group by p.user_id, p.operation_id, p.start_date, p.end_date;

-- Salva o funil + o faturado de cada casa numa única transação.
-- p_revenues: [{"house_id": "...", "revenue": 123.45 | null}]
-- Só cria o período da casa quando há faturado informado; nunca apaga nada.
create or replace function public.save_funnel(
  p_id               uuid,
  p_operation_id     uuid,
  p_start            date,
  p_end              date,
  p_leads            integer,
  p_reached_pitch    integer,
  p_accessed_channel integer,
  p_sendpulse        integer,
  p_notes            text,
  p_revenues         jsonb
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id  uuid := p_id;
  v_rev record;
  v_per uuid;
begin
  if v_id is null then
    insert into public.funnel_periods (operation_id, start_date, end_date, leads, reached_pitch, accessed_channel, sendpulse_deposits, notes)
    values (p_operation_id, p_start, p_end, p_leads, p_reached_pitch, p_accessed_channel, p_sendpulse, p_notes)
    returning id into v_id;
  else
    update public.funnel_periods
       set leads = p_leads, reached_pitch = p_reached_pitch, accessed_channel = p_accessed_channel,
           sendpulse_deposits = p_sendpulse, notes = p_notes
     where id = v_id and operation_id = p_operation_id and start_date = p_start and end_date = p_end;
    if not found then
      raise exception using errcode = 'RV003', message = 'Registro não encontrado (as datas de um registro salvo não podem ser alteradas).';
    end if;
  end if;

  for v_rev in select (x->>'house_id')::uuid as house_id, (x->>'revenue')::numeric as revenue
                 from jsonb_array_elements(coalesce(p_revenues, '[]'::jsonb)) x
  loop
    v_per := null;
    select id into v_per from public.periods
     where operation_id = p_operation_id and house_id = v_rev.house_id and start_date = p_start and end_date = p_end;
    if v_per is not null then
      update public.periods set total_revenue_usd = v_rev.revenue where id = v_per;
    elsif v_rev.revenue is not null then
      insert into public.periods (operation_id, house_id, start_date, end_date, total_revenue_usd)
      values (p_operation_id, v_rev.house_id, p_start, p_end, v_rev.revenue);
    end if;
  end loop;

  return v_id;
end $$;

revoke all on function public.save_funnel(uuid,uuid,date,date,integer,integer,integer,integer,text,jsonb) from public, anon;
grant execute on function public.save_funnel(uuid,uuid,date,date,integer,integer,integer,integer,text,jsonb) to authenticated;
