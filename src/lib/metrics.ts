import type { NumericPeriodKey, Period } from './types';

/**
 * Regras de cálculo das porcentagens — altere aqui se quiser outra base.
 *   % no pitch      = Chegou ao pitch / Leads
 *   % depositou     = FTD IA / Registros
 *   % qualificou    = QFTD / FTD IA
 *   % acessou canal = Acessou canal / FTD IA
 */
export const RATES: { key: string; label: string; num: NumericPeriodKey; den: NumericPeriodKey; hint: string }[] = [
  { key: 'pitch', label: '% no pitch', num: 'reached_pitch', den: 'leads', hint: 'Chegou ao pitch ÷ Leads' },
  { key: 'deposit', label: '% depositou', num: 'ftd_ia', den: 'registrations', hint: 'FTD IA ÷ Registros' },
  { key: 'qualified', label: '% qualificou', num: 'qftd', den: 'ftd_ia', hint: 'QFTD ÷ FTD IA' },
  { key: 'channel', label: '% acessou canal', num: 'accessed_channel', den: 'ftd_ia', hint: 'Acessou canal ÷ FTD IA' },
];

/** Divisão segura: retorna null se faltar dado ou se o denominador for 0. */
export function pct(num: number | null | undefined, den: number | null | undefined): number | null {
  if (num == null || den == null || den === 0) return null;
  return num / den;
}

/** Soma ignorando ausentes. Se todos forem ausentes, retorna null (não 0). */
export function sumField(rows: Period[], key: NumericPeriodKey): number | null {
  const vals = rows.map((r) => r[key]).filter((v): v is number => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

/** Taxa agregada usando só os períodos que têm numerador E denominador. */
export function aggregateRate(rows: Period[], num: NumericPeriodKey, den: NumericPeriodKey): number | null {
  const both = rows.filter((r) => r[num] != null && r[den] != null);
  if (!both.length) return null;
  return pct(sumField(both, num), sumField(both, den));
}
