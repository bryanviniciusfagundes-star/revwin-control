-- Regra de aposta para qualificar (QFTD), por casa dentro de cada operação.
-- Ex.: Melbet = aposta > 0 ; Betwinner = aposta >= 10 (USD)
alter table public.operation_houses
  add column bets_operator text not null default 'gt' check (bets_operator in ('gt','gte')),
  add column bets_min_usd  numeric(12,2) not null default 0 check (bets_min_usd >= 0);
