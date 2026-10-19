const DASH = '—';

export const fmtInt = (v: number | null | undefined) =>
  v == null ? DASH : v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });

export const fmtUSD = (v: number | null | undefined) =>
  v == null ? DASH : 'US$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtPct = (v: number | null | undefined) =>
  v == null ? DASH : (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';

/** 'yyyy-mm-dd' → 'dd/mm/yyyy' sem passar por Date (evita erro de fuso). */
export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

export const fmtShortDate = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};

export const fmtRange = (a: string, b: string) => (a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`);

/** Data local de hoje (ou deslocada em dias) em 'yyyy-mm-dd'. */
export function localISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Campo de texto → número. Vazio vira null (nunca 0). Inválido lança erro. */
export function parseNum(s: string, opts: { integer?: boolean; min?: number; label: string }): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error(`${opts.label}: valor inválido.`);
  if (opts.integer && !Number.isInteger(n)) throw new Error(`${opts.label}: use um número inteiro.`);
  if (opts.min != null && n < opts.min) throw new Error(`${opts.label}: não pode ser menor que ${opts.min}.`);
  return n;
}

export const numToField = (v: number | null | undefined) => (v == null ? '' : String(v));
