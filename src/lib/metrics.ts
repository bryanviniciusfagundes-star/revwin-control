import type { FunnelPeriod, NumericFunnelKey, NumericPeriodKey, Period } from './types';

/** Divisão segura: retorna null se faltar dado ou se o denominador for 0. */
export function pct(num: number | null | undefined, den: number | null | undefined): number | null {
  if (num == null || den == null || den === 0) return null;
  return num / den;
}

/** Soma ignorando ausentes. Se todos forem ausentes, retorna null (não 0). */
export function sumField<T>(rows: T[], key: keyof T): number | null {
  const vals = rows.map((r) => r[key] as unknown as number | null).filter((v): v is number => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

/** Taxa usando só as linhas que têm numerador E denominador. */
export function aggregateRate<T>(rows: T[], num: keyof T, den: keyof T): number | null {
  const both = rows.filter((r) => r[num] != null && r[den] != null);
  if (!both.length) return null;
  return pct(sumField(both, num), sumField(both, den));
}

export interface Totals {
  leads: number | null;
  reached_pitch: number | null;
  accessed_channel: number | null;
  sendpulse_deposits: number | null;
  registrations: number | null;
  ftd_ia: number | null;
  ftd_panel: number | null;
  qftd: number | null;
  deposits_sum_usd: number | null;
  total_revenue_usd: number | null;
}

/**
 * Junta o funil da operação (null quando filtrado por casa) com os dados das casas.
 */
export function computeTotals(funnels: FunnelPeriod[] | null, houses: Period[]): Totals {
  const f = (k: NumericFunnelKey) => (funnels ? sumField(funnels, k) : null);
  const h = (k: NumericPeriodKey) => sumField(houses, k);
  return {
    leads: f('leads'),
    reached_pitch: f('reached_pitch'),
    accessed_channel: f('accessed_channel'),
    sendpulse_deposits: f('sendpulse_deposits'),
    registrations: h('registrations'),
    ftd_ia: h('ftd_ia'),
    ftd_panel: h('ftd_panel'),
    qftd: h('qftd'),
    deposits_sum_usd: h('deposits_sum_usd'),
    total_revenue_usd: h('total_revenue_usd'),
  };
}

/**
 * Regras das porcentagens — altere aqui se quiser outra base.
 *   % no pitch      = Chegou ao pitch / Leads                (funil da operação)
 *   % depositou     = FTD IA / Registros                     (casas)
 *   % qualificou    = QFTD / FTD IA                          (casas)
 *   % acessou canal = Acessou canal / FTD IA (soma das casas)
 */
export const RATES: {
  key: string;
  label: string;
  hint: string;
  calc: (t: Totals, funnels: FunnelPeriod[] | null, houses: Period[]) => number | null;
}[] = [
  { key: 'pitch', label: '% no pitch', hint: 'Chegou ao pitch ÷ Leads', calc: (_t, f) => (f ? aggregateRate(f, 'reached_pitch', 'leads') : null) },
  { key: 'deposit', label: '% depositou', hint: 'FTD IA ÷ Registros', calc: (_t, _f, h) => aggregateRate(h, 'ftd_ia', 'registrations') },
  { key: 'qualified', label: '% qualificou', hint: 'QFTD ÷ FTD IA', calc: (_t, _f, h) => aggregateRate(h, 'qftd', 'ftd_ia') },
  { key: 'channel', label: '% acessou canal', hint: 'Acessou canal ÷ FTD IA', calc: (t) => pct(t.accessed_channel, t.ftd_ia) },
];
