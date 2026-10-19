// ============================================================
// Conciliação IA × casa — cálculo puro (sem acesso ao banco).
// Regras:
//  • FTD = jogador com depósito > 0 (independente de status).
//  • IDs diferentes NÃO são tratados como jogadores diferentes:
//    o que não casa é "sem correspondência", não "falso".
//  • Valores só são comparados quando equivalentes (1º depósito × 1º depósito,
//    ou total com 1 único depósito) e ambos em USD.
//  • Baseline e apostas usam os dados da casa. Ausente ≠ zero.
// ============================================================
import type { BetsOperator } from './types';
import type { DepositKind } from './csv';

export interface RecRecord {
  player_id: string;
  deposit_amount: number | null;
  deposit_currency: string | null;
  deposit_usd: number | null;
  deposit_count: number;
  bets_usd: number | null;
}

export type ItemStatus =
  | 'ok' // nas duas, valores dentro da tolerância
  | 'divergence' // nas duas, diferença acima da tolerância
  | 'not_comparable' // nas duas, mas valores não equivalentes / sem conversão
  | 'house_no_deposit' // ID existe na casa, mas a casa não mostra depósito
  | 'only_ia' // ID da IA não encontrado na casa
  | 'only_house'; // FTD na casa sem ID correspondente na IA

export const STATUS_LABEL: Record<ItemStatus, string> = {
  ok: 'OK',
  divergence: 'Divergência',
  not_comparable: 'Não comparável',
  house_no_deposit: 'Casa sem depósito',
  only_ia: 'Só na IA',
  only_house: 'Só na casa',
};

export interface RecItem {
  player_id: string;
  status: ItemStatus;
  reason: string | null;
  ia_deposit: number | null; // original
  ia_currency: string | null;
  ia_usd: number | null;
  house_usd: number | null;
  house_count: number | null;
  diff_usd: number | null; // IA − casa
  bets_usd: number | null;
  baseline: boolean | null; // casa: soma dos depósitos ≥ baseline
  qualified: boolean | null; // baseline + regra de aposta
}

export interface RecSummary {
  ftd_ia: number;
  ftd_house: number;
  in_both: number;
  only_ia: number;
  house_no_deposit: number;
  only_house: number;
  rows_without_id_ia: number;
  rows_without_id_house: number;
  baseline_count: number | null;
  qualified_count: number | null; // QFTD
  baseline_without_bets: number | null; // atingiu baseline mas não a regra de aposta
  compared: number;
  divergences: number;
  not_comparable: number;
  implied_rates: Record<string, { rate: number; pairs: number }>; // moeda → unidades por US$ 1
}

export interface RecInput {
  ia: RecRecord[];
  house: RecRecord[];
  iaKind: DepositKind;
  houseKind: DepositKind;
  rowsWithoutIdIa: number;
  rowsWithoutIdHouse: number;
  baselineUsd: number;
  betsOperator: BetsOperator;
  betsMinUsd: number;
  toleranceUsd: number;
  /** Taxas da IA (moeda → unidades por US$ 1). Recalcula o USD da IA. */
  iaRates: Record<string, number>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const hasDeposit = (r: RecRecord) => r.deposit_amount != null && r.deposit_amount > 0;

function iaUsd(r: RecRecord, rates: Record<string, number>): number | null {
  if (r.deposit_amount == null) return null;
  const c = (r.deposit_currency ?? '').toUpperCase();
  if (c === 'USD') return r.deposit_amount;
  const rate = c ? rates[c] : undefined;
  return rate && rate > 0 ? round2(r.deposit_amount / rate) : null;
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function betsOk(bets: number | null, op: BetsOperator, min: number): boolean | null {
  if (bets == null) return null;
  return op === 'gte' ? bets >= min - 1e-9 : bets > min + 1e-9;
}

export function reconcile(inp: RecInput): { summary: RecSummary; items: RecItem[] } {
  const houseById = new Map(inp.house.map((r) => [r.player_id, r]));
  const iaById = new Map(inp.ia.map((r) => [r.player_id, r]));
  const iaFtd = inp.ia.filter(hasDeposit);
  const houseFtd = inp.house.filter(hasDeposit);

  // valor equivalente: 1º depósito, ou total quando houve 1 único depósito
  const equivalent = (kind: DepositKind, count: number) => kind === 'first' || count === 1;

  const qualify = (h: RecRecord | undefined) => {
    if (!h || h.deposit_usd == null) return { baseline: null, qualified: null };
    const baseline = h.deposit_usd >= inp.baselineUsd - 1e-9;
    const b = betsOk(h.bets_usd, inp.betsOperator, inp.betsMinUsd);
    return { baseline, qualified: baseline ? b : false };
  };

  const items: RecItem[] = [];
  const pairsByCurrency = new Map<string, number[]>();

  for (const r of iaFtd) {
    const h = houseById.get(r.player_id);
    const usd = iaUsd(r, inp.iaRates);
    const base: RecItem = {
      player_id: r.player_id,
      status: 'only_ia',
      reason: null,
      ia_deposit: r.deposit_amount,
      ia_currency: r.deposit_currency,
      ia_usd: usd,
      house_usd: h?.deposit_usd ?? null,
      house_count: h ? h.deposit_count : null,
      diff_usd: null,
      bets_usd: h?.bets_usd ?? null,
      ...qualify(h),
    };
    if (!h) {
      base.reason = 'ID não encontrado no arquivo da casa';
    } else if (!hasDeposit(h)) {
      base.status = 'house_no_deposit';
      base.reason = 'A casa não mostra depósito para este ID';
    } else {
      // taxa implícita da casa: pares com 1 depósito dos dois lados, IA em moeda local, casa em USD
      const cur = (r.deposit_currency ?? '').toUpperCase();
      if (cur && cur !== 'USD' && h.deposit_usd && h.deposit_usd > 0 && equivalent(inp.iaKind, r.deposit_count) && equivalent(inp.houseKind, h.deposit_count)) {
        const list = pairsByCurrency.get(cur) ?? [];
        list.push((r.deposit_amount as number) / h.deposit_usd);
        pairsByCurrency.set(cur, list);
      }
      if (!equivalent(inp.houseKind, h.deposit_count)) {
        base.status = 'not_comparable';
        base.reason = `A casa mostra o total de ${h.deposit_count} depósitos`;
      } else if (!equivalent(inp.iaKind, r.deposit_count)) {
        base.status = 'not_comparable';
        base.reason = 'A IA mostra total de depósitos';
      } else if (usd == null) {
        base.status = 'not_comparable';
        base.reason = r.deposit_currency ? `Sem taxa de conversão para ${r.deposit_currency}` : 'IA sem moeda informada';
      } else if (h.deposit_usd == null) {
        base.status = 'not_comparable';
        base.reason = 'Casa sem valor em USD';
      } else {
        base.diff_usd = round2(usd - h.deposit_usd);
        base.status = Math.abs(base.diff_usd) > inp.toleranceUsd + 0.005 ? 'divergence' : 'ok';
      }
    }
    items.push(base);
  }

  for (const h of houseFtd) {
    if (iaById.has(h.player_id) && hasDeposit(iaById.get(h.player_id)!)) continue;
    items.push({
      player_id: h.player_id,
      status: 'only_house',
      reason: iaById.has(h.player_id) ? 'Na IA sem valor de depósito' : 'ID não encontrado no arquivo da IA',
      ia_deposit: null,
      ia_currency: null,
      ia_usd: null,
      house_usd: h.deposit_usd,
      house_count: h.deposit_count,
      diff_usd: null,
      bets_usd: h.bets_usd,
      ...qualify(h),
    });
  }

  // baseline e QFTD: sobre os jogadores com depósito na casa
  const evaluated = houseFtd.map(qualify);
  const unknownDeposit = evaluated.some((e) => e.baseline == null);
  const baselineCount = unknownDeposit ? null : evaluated.filter((e) => e.baseline).length;
  const unknownBets = evaluated.some((e) => e.baseline && e.qualified == null);
  const qualifiedCount = baselineCount == null || unknownBets ? null : evaluated.filter((e) => e.qualified).length;

  const count = (s: ItemStatus) => items.filter((i) => i.status === s).length;
  const implied: RecSummary['implied_rates'] = {};
  pairsByCurrency.forEach((v, k) => {
    if (v.length >= 3) implied[k] = { rate: round2(median(v)), pairs: v.length };
  });

  return {
    items,
    summary: {
      ftd_ia: iaFtd.length,
      ftd_house: houseFtd.length,
      in_both: iaFtd.filter((r) => houseById.has(r.player_id)).length,
      only_ia: count('only_ia'),
      house_no_deposit: count('house_no_deposit'),
      only_house: count('only_house'),
      rows_without_id_ia: inp.rowsWithoutIdIa,
      rows_without_id_house: inp.rowsWithoutIdHouse,
      baseline_count: baselineCount,
      qualified_count: qualifiedCount,
      baseline_without_bets: baselineCount != null && qualifiedCount != null ? baselineCount - qualifiedCount : null,
      compared: count('ok') + count('divergence'),
      divergences: count('divergence'),
      not_comparable: count('not_comparable'),
      implied_rates: implied,
    },
  };
}

/** Exporta itens em CSV (separador ";" e vírgula decimal, para abrir direto no Excel em português). */
export function itemsToCsv(items: RecItem[]): string {
  const n = (v: number | null) => (v == null ? '' : v.toFixed(2).replace('.', ','));
  const b = (v: boolean | null) => (v == null ? '' : v ? 'sim' : 'não');
  const header = ['ID do jogador', 'Depósito IA (original)', 'Moeda IA', 'Depósito IA (USD)', 'Depósito casa (USD)', 'Qtd. depósitos casa',
    'Diferença (USD)', 'Valor apostado (USD)', 'Atingiu baseline', 'Qualificado', 'Status', 'Motivo'];
  const esc = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = items.map((i) => [i.player_id, n(i.ia_deposit), i.ia_currency ?? '', n(i.ia_usd), n(i.house_usd), i.house_count == null ? '' : String(i.house_count),
    n(i.diff_usd), n(i.bets_usd), b(i.baseline), b(i.qualified), STATUS_LABEL[i.status], i.reason ?? ''].map(esc).join(';'));
  return '﻿' + [header.join(';'), ...lines].join('\r\n');
}
