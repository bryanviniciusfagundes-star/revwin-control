import Papa from 'papaparse';

// ============================================================
// Leitura e normalização dos CSVs (IA e casa).
// Regras: nada é inventado — valor vazio ou ilegível vira null,
// e cada problema é contado e mostrado na prévia.
// ============================================================

export type Source = 'ia' | 'house';
export const SOURCE_LABEL: Record<Source, string> = { ia: 'IA / Revwin', house: 'Casa de apostas' };

export type FieldKey = 'id' | 'deposit' | 'currency' | 'bets' | 'date' | 'status';
export const FIELDS: { key: FieldKey; label: string; required?: boolean }[] = [
  { key: 'id', label: 'ID do jogador', required: true },
  { key: 'deposit', label: 'Depósito' },
  { key: 'currency', label: 'Moeda' },
  { key: 'bets', label: 'Apostas' },
  { key: 'date', label: 'Data' },
  { key: 'status', label: 'Status' },
];

export type ColumnMap = Partial<Record<FieldKey, string>>;
export type DecimalSep = 'auto' | ',' | '.';
export type DateFormat = 'auto' | 'dmy' | 'mdy' | 'ymd';
export type DepositKind = 'first' | 'total';

export interface ImportOptions {
  columns: ColumnMap;
  depositKind: DepositKind;
  decimal: DecimalSep;
  dateFormat: DateFormat;
  fileCurrency: string; // usada quando não há coluna de moeda
  rates: Record<string, string>; // moeda → quantas unidades valem 1 USD (texto digitado)
}

export interface ParsedFile {
  name: string;
  hash: string;
  text: string;
  headers: string[];
  rows: string[][];
  delimiter: string;
}

export interface PlayerRecord {
  player_id: string;
  deposit_amount: number | null;
  deposit_currency: string | null;
  deposit_usd: number | null;
  deposit_count: number;
  bets_amount: number | null;
  bets_usd: number | null;
  event_date: string | null;
  status: string | null;
  raw: Record<string, string>[];
}

export interface NormalizeResult {
  records: PlayerRecord[];
  stats: {
    dataRows: number;
    rowsWithoutId: number;
    players: number;
    multiRowPlayers: number;
    ftd: number; // jogadores com depósito > 0
    noDeposit: number; // jogadores sem valor de depósito
    badNumbers: string[]; // exemplos de valores ilegíveis
    badNumberCount: number;
    badDates: string[];
    badDateCount: number;
    outOfPeriod: number;
    currencies: string[];
    missingRates: string[];
    mixedCurrencyPlayers: number;
    detectedDecimal: ',' | '.';
    detectedDateFormat: Exclude<DateFormat, 'auto'>;
  };
}

// ---------------- Arquivo ----------------

/** Lê o arquivo, calcula o hash e decodifica (UTF-8, ou Windows-1252 se vier do Excel). */
export async function readCsvFile(file: File): Promise<ParsedFile> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');

  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
  text = text.replace(/^﻿/, '');

  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  const all = parsed.data.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  if (all.length < 2) throw new Error('O arquivo não tem cabeçalho e dados.');

  // nomes de coluna únicos
  const seen = new Map<string, number>();
  const headers = all[0].map((h, i) => {
    const base = String(h ?? '').trim() || `Coluna ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base} (${n})` : base;
  });
  const rows = all.slice(1).map((r) => headers.map((_, i) => String(r[i] ?? '').trim()));
  return { name: file.name, hash, text, headers, rows, delimiter: parsed.meta.delimiter };
}

/** Sugestão de mapeamento pelo nome das colunas. */
export function suggestColumns(headers: string[]): ColumnMap {
  const rules: [FieldKey, RegExp][] = [
    ['id', /(^id$|player|jogador|usu[aá]rio|user|cliente|account|conta|\bid\b)/i],
    ['deposit', /(dep[oó]sit|ftd.*(valor|amount|monto)|^valor$|^monto|amount)/i],
    ['currency', /(moeda|moneda|currency|^curr|divisa)/i],
    ['bets', /(apost|apuest|\bbets?\b|wager|stake|turnover)/i],
    ['date', /(^data|date|fecha|^dia$|registro em)/i],
    ['status', /(status|estado|situa)/i],
  ];
  const map: ColumnMap = {};
  const used = new Set<string>();
  for (const [key, re] of rules) {
    const h = headers.find((x) => re.test(x) && !used.has(x));
    if (h) {
      map[key] = h;
      used.add(h);
    }
  }
  return map;
}

// ---------------- Números ----------------

function cleanNumber(raw: string) {
  return raw.replace(/\s/g, '').replace(/[^\d,.\-]/g, '');
}

/** Descobre o separador decimal olhando todos os valores da coluna. */
export function detectDecimal(values: string[]): ',' | '.' {
  let comma = 0;
  let dot = 0;
  for (const v of values) {
    const s = cleanNumber(v);
    const c = s.lastIndexOf(',');
    const d = s.lastIndexOf('.');
    if (c >= 0 && d >= 0) (c > d ? comma++ : dot++);
    else if (c >= 0 && s.length - c - 1 !== 3) comma++;
    else if (d >= 0 && s.length - d - 1 !== 3) dot++;
  }
  return comma > dot ? ',' : '.';
}

/** Converte texto em número. Vazio → null. Ilegível → NaN (contado como problema). */
export function parseNumber(raw: string, dec: ',' | '.'): number | null {
  const t = raw.trim();
  if (t === '' || t === '-' || /^(n\/?a|null|none|—)$/i.test(t)) return null;
  let s = cleanNumber(t);
  if (!/\d/.test(s)) return NaN;
  const thousands = dec === ',' ? '.' : ',';
  s = s.split(thousands).join('');
  if (dec === ',') s = s.replace(',', '.');
  if ((s.match(/\./g) ?? []).length > 1) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// ---------------- Datas ----------------

export function detectDateFormat(values: string[]): Exclude<DateFormat, 'auto'> {
  let dmy = 0;
  let mdy = 0;
  for (const v of values) {
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(v.trim())) return 'ymd';
    const m = v.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    else if (+m[2] > 12) mdy++;
  }
  return mdy > dmy ? 'mdy' : 'dmy';
}

/** Retorna 'yyyy-mm-dd', null se vazio, ou 'invalid'. */
export function parseDate(raw: string, fmt: Exclude<DateFormat, 'auto'>): string | null | 'invalid' {
  const t = raw.trim();
  if (!t) return null;
  let y: number, m: number, d: number;
  const iso = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  const other = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (iso) [y, m, d] = [+iso[1], +iso[2], +iso[3]];
  else if (other) {
    const a = +other[1], b = +other[2];
    y = +other[3];
    if (y < 100) y += 2000;
    [d, m] = fmt === 'mdy' ? [b, a] : [a, b];
  } else return 'invalid';
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return 'invalid';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ---------------- Moeda ----------------

export function normalizeCurrency(raw: string | undefined | null): string | null {
  const t = (raw ?? '').trim().toUpperCase();
  if (!t) return null;
  if (t === 'US$' || t === 'U$S' || t === 'DOLAR' || t === 'DÓLAR') return 'USD';
  return t;
}

/** Taxa digitada ("4.150,50" ou "4150.5") → número > 0, senão null. */
export function parseRate(s: string | undefined): number | null {
  if (!s || !s.trim()) return null;
  const t = cleanNumber(s);
  // "4.150" ou "4,150" = quatro mil cento e cinquenta; "0,925" = decimal
  const single = t.match(/^(\d+)([.,])(\d{3})$/);
  const dec: ',' | '.' = single ? (single[1] === '0' ? single[2] as ',' | '.' : single[2] === ',' ? '.' : ',') : detectDecimal([t]);
  const n = parseNumber(t, dec);
  return n != null && Number.isFinite(n) && n > 0 ? n : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------- Normalização ----------------

export function normalize(file: ParsedFile, opt: ImportOptions, period?: { start: string; end: string }): NormalizeResult {
  const idx = (k: FieldKey) => (opt.columns[k] ? file.headers.indexOf(opt.columns[k]!) : -1);
  const iId = idx('id'), iDep = idx('deposit'), iCur = idx('currency'), iBet = idx('bets'), iDate = idx('date'), iSt = idx('status');

  const numericValues = file.rows.flatMap((r) => [iDep >= 0 ? r[iDep] : '', iBet >= 0 ? r[iBet] : ''].filter(Boolean));
  const dec = opt.decimal === 'auto' ? detectDecimal(numericValues) : opt.decimal;
  const dateFmt = opt.dateFormat === 'auto' ? detectDateFormat(iDate >= 0 ? file.rows.map((r) => r[iDate]) : []) : opt.dateFormat;

  const badNumbers: string[] = [];
  let badNumberCount = 0;
  const badDates: string[] = [];
  let badDateCount = 0;
  let rowsWithoutId = 0;

  const num = (v: string) => {
    const n = parseNumber(v, dec);
    if (n != null && Number.isNaN(n)) {
      badNumberCount++;
      if (badNumbers.length < 5) badNumbers.push(v);
      return null;
    }
    return n;
  };

  // agrupa linhas por jogador
  const groups = new Map<string, { rows: string[][]; order: number }>();
  file.rows.forEach((r, order) => {
    const id = iId >= 0 ? r[iId].trim() : '';
    if (!id) {
      rowsWithoutId++;
      return;
    }
    const g = groups.get(id);
    if (g) g.rows.push(r);
    else groups.set(id, { rows: [r], order });
  });

  const currencies = new Set<string>();
  let mixedCurrencyPlayers = 0;
  let outOfPeriod = 0;

  const records: PlayerRecord[] = [...groups.entries()].map(([player_id, g]) => {
    const parsed = g.rows.map((r) => {
      let date: string | null = null;
      if (iDate >= 0) {
        const d = parseDate(r[iDate], dateFmt);
        if (d === 'invalid') {
          badDateCount++;
          if (badDates.length < 5) badDates.push(r[iDate]);
        } else date = d;
      }
      return {
        r,
        dep: iDep >= 0 ? num(r[iDep]) : null,
        bet: iBet >= 0 ? num(r[iBet]) : null,
        cur: iCur >= 0 ? normalizeCurrency(r[iCur]) : normalizeCurrency(opt.fileCurrency),
        date,
      };
    });
    // ordem cronológica (sem data vai para o fim, mantendo a ordem do arquivo)
    const sorted = [...parsed].sort((a, b) => (a.date ?? '9999') .localeCompare(b.date ?? '9999'));

    const withDep = sorted.filter((p) => p.dep != null);
    const deposit_amount =
      opt.depositKind === 'first'
        ? withDep[0]?.dep ?? null
        : withDep.length
          ? round2(withDep.reduce((s, p) => s + (p.dep as number), 0))
          : null;
    const bets = sorted.filter((p) => p.bet != null);
    const bets_amount = bets.length ? round2(bets.reduce((s, p) => s + (p.bet as number), 0)) : null;

    const curs = new Set(sorted.map((p) => p.cur).filter((c): c is string => !!c));
    if (curs.size > 1) mixedCurrencyPlayers++;
    const currency = curs.size === 1 ? [...curs][0] : null;
    if (currency) currencies.add(currency);

    // conversão: só com moeda única e taxa informada
    const rate = currency === 'USD' ? 1 : currency ? parseRate(opt.rates[currency]) : null;
    const toUsd = (v: number | null) => (v == null || rate == null ? null : round2(v / rate));

    const event_date = sorted.find((p) => p.date)?.date ?? null;
    if (period && event_date && (event_date < period.start || event_date > period.end)) outOfPeriod++;

    return {
      player_id,
      deposit_amount,
      deposit_currency: currency,
      deposit_usd: toUsd(deposit_amount),
      deposit_count: withDep.filter((p) => (p.dep as number) > 0).length,
      bets_amount,
      bets_usd: toUsd(bets_amount),
      event_date,
      status: iSt >= 0 ? sorted.map((p) => p.r[iSt]).find((s) => s) ?? null : null,
      raw: g.rows.map((r) => Object.fromEntries(file.headers.map((h, i) => [h, r[i]]))),
    };
  });

  const curList = [...currencies].sort();
  return {
    records,
    stats: {
      dataRows: file.rows.length,
      rowsWithoutId,
      players: records.length,
      multiRowPlayers: [...groups.values()].filter((g) => g.rows.length > 1).length,
      ftd: records.filter((r) => r.deposit_amount != null && r.deposit_amount > 0).length,
      noDeposit: records.filter((r) => r.deposit_amount == null).length,
      badNumbers,
      badNumberCount,
      badDates,
      badDateCount,
      outOfPeriod,
      currencies: curList,
      missingRates: curList.filter((c) => c !== 'USD' && parseRate(opt.rates[c]) == null),
      mixedCurrencyPlayers,
      detectedDecimal: dec,
      detectedDateFormat: dateFmt,
    },
  };
}
