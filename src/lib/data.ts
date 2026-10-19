import { supabase } from './supabase';
import type { BetsOperator, FunnelPeriod, House, Operation, OperationStatus, Period } from './types';
import { parseRate, type ImportOptions, type PlayerRecord, type Source } from './csv';
import type { RecItem, RecRecord, RecSummary } from './recon';

/** Traduz erros do banco para mensagens claras. */
export function friendlyError(e: unknown): string {
  const err = e as { code?: string; message?: string };
  switch (err?.code) {
    case '23505':
      return 'Já existe um registro com esse nome.';
    case '23P01':
      return 'Já existe um registro dessa operação e casa com período sobreposto. Edite o registro existente.';
    case '23503':
      return 'Não é possível excluir: existem dados vinculados.';
    case 'RV001':
    case 'RV002':
    case 'RV003':
      return err.message ?? 'Importação recusada.';
    case '23514':
      return 'Algum valor está fora do permitido (datas invertidas ou número negativo).';
    default:
      return err?.message ?? 'Erro inesperado.';
  }
}

const n = (v: unknown): number | null => (v == null ? null : Number(v));

// ---------------- Casas ----------------
export async function fetchHouses(): Promise<House[]> {
  const { data, error } = await supabase.from('houses').select('id,name').order('name');
  if (error) throw error;
  return data ?? [];
}

// ---------------- Operações ----------------
export async function fetchOperations(): Promise<Operation[]> {
  const { data, error } = await supabase
    .from('operations')
    .select('*, operation_houses(bets_operator, bets_min_usd, houses(id,name))')
    .order('name');
  if (error) throw error;
  return (data ?? []).map((o: any) => ({
    id: o.id,
    name: o.name,
    expert: o.expert,
    geo: o.geo,
    baseline_usd: Number(o.baseline_usd),
    cpa_usd: Number(o.cpa_usd),
    status: o.status,
    created_at: o.created_at,
    houses: (o.operation_houses ?? [])
      .filter((oh: any) => oh.houses)
      .map((oh: any) => ({ ...oh.houses, bets_operator: oh.bets_operator, bets_min_usd: Number(oh.bets_min_usd) }))
      .sort((a: House, b: House) => a.name.localeCompare(b.name)),
  }));
}

export interface OperationInput {
  id?: string;
  name: string;
  expert: string;
  geo: string;
  baseline_usd: number;
  cpa_usd: number;
  status: OperationStatus;
  houses: { name: string; bets_operator: BetsOperator; bets_min_usd: number }[];
}

export async function saveOperation(input: OperationInput) {
  const payload = {
    name: input.name.trim(),
    expert: input.expert.trim() || null,
    geo: input.geo.trim().toUpperCase(),
    baseline_usd: input.baseline_usd,
    cpa_usd: input.cpa_usd,
    status: input.status,
  };

  let opId = input.id;
  if (opId) {
    const { error } = await supabase.from('operations').update(payload).eq('id', opId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase.from('operations').insert(payload).select('id').single();
    if (error) throw error;
    opId = data.id as string;
  }

  // Garante que cada casa existe (sem duplicar por maiúsculas/minúsculas)
  const rules = new Map(input.houses.map((h) => [h.name.trim().toLowerCase(), h]));
  const names = [...new Map(input.houses.map((h) => [h.name.trim().toLowerCase(), h.name.trim()])).values()].filter(Boolean);
  const existing = await fetchHouses();
  const byName = new Map(existing.map((h) => [h.name.toLowerCase(), h]));
  const missing = names.filter((nm) => !byName.has(nm.toLowerCase()));
  if (missing.length) {
    const { data, error } = await supabase.from('houses').insert(missing.map((name) => ({ name }))).select('id,name');
    if (error) throw error;
    (data ?? []).forEach((h) => byName.set(h.name.toLowerCase(), h));
  }
  const wanted = names.map((nm) => byName.get(nm.toLowerCase())!.id);

  // Sincroniza vínculos
  const { data: links, error: e1 } = await supabase.from('operation_houses').select('house_id').eq('operation_id', opId);
  if (e1) throw e1;
  const current = new Set((links ?? []).map((l) => l.house_id as string));
  const toRemove = [...current].filter((id) => !wanted.includes(id));
  const toAdd = wanted.filter((id) => !current.has(id));
  if (toRemove.length) {
    const { error } = await supabase.from('operation_houses').delete().eq('operation_id', opId).in('house_id', toRemove);
    if (error) throw error;
  }
  const ruleFor = (houseId: string) => {
    const name = [...byName.values()].find((h) => h.id === houseId)!.name.toLowerCase();
    const r = rules.get(name)!;
    return { bets_operator: r.bets_operator, bets_min_usd: r.bets_min_usd };
  };
  if (toAdd.length) {
    const { error } = await supabase
      .from('operation_houses')
      .insert(toAdd.map((house_id) => ({ operation_id: opId, house_id, ...ruleFor(house_id) })));
    if (error) throw error;
  }
  // atualiza a regra de aposta das casas que já estavam vinculadas
  for (const house_id of wanted.filter((id) => current.has(id))) {
    const { error } = await supabase.from('operation_houses').update(ruleFor(house_id)).eq('operation_id', opId).eq('house_id', house_id);
    if (error) throw error;
  }
}

export async function deleteOperation(id: string) {
  const { error } = await supabase.from('operations').delete().eq('id', id);
  if (error) throw error;
}

// ---------------- Períodos ----------------
function normalizePeriod(p: any): Period {
  return {
    ...p,
    total_revenue_usd: n(p.total_revenue_usd),
    registrations: n(p.registrations),
    ftd_ia: n(p.ftd_ia),
    ftd_panel: n(p.ftd_panel),
    qftd: n(p.qftd),
    deposits_sum_usd: n(p.deposits_sum_usd),
  };
}

export interface PeriodFilter {
  operationId?: string;
  houseId?: string;
  from?: string; // inclui períodos que terminam a partir desta data
  to?: string; // inclui períodos que começam até esta data
  newestFirst?: boolean;
  limit?: number;
}

export async function fetchPeriods(f: PeriodFilter = {}): Promise<Period[]> {
  let q = supabase.from('periods').select('*').order('start_date', { ascending: !f.newestFirst });
  if (f.operationId) q = q.eq('operation_id', f.operationId);
  if (f.houseId) q = q.eq('house_id', f.houseId);
  if (f.to) q = q.lte('start_date', f.to);
  if (f.from) q = q.gte('end_date', f.from);
  if (f.limit) q = q.limit(f.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(normalizePeriod);
}

// ---------------- Funil da operação ----------------
function normalizeFunnel(f: any): FunnelPeriod {
  return {
    ...f,
    leads: n(f.leads),
    reached_pitch: n(f.reached_pitch),
    accessed_channel: n(f.accessed_channel),
    sendpulse_deposits: n(f.sendpulse_deposits),
  };
}

export async function fetchFunnelPeriods(f: Omit<PeriodFilter, 'houseId'> = {}): Promise<FunnelPeriod[]> {
  let q = supabase.from('funnel_periods').select('*').order('start_date', { ascending: !f.newestFirst });
  if (f.operationId) q = q.eq('operation_id', f.operationId);
  if (f.to) q = q.lte('start_date', f.to);
  if (f.from) q = q.gte('end_date', f.from);
  if (f.limit) q = q.limit(f.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(normalizeFunnel);
}

export interface FunnelInput {
  id?: string;
  operation_id: string;
  start_date: string;
  end_date: string;
  leads: number | null;
  reached_pitch: number | null;
  accessed_channel: number | null;
  sendpulse_deposits: number | null;
  notes: string | null;
  revenues: { house_id: string; revenue: number | null }[];
}

/** Salva o funil e o faturado de cada casa numa única transação. */
export async function saveFunnel(i: FunnelInput) {
  const { error } = await supabase.rpc('save_funnel', {
    p_id: i.id ?? null,
    p_operation_id: i.operation_id,
    p_start: i.start_date,
    p_end: i.end_date,
    p_leads: i.leads,
    p_reached_pitch: i.reached_pitch,
    p_accessed_channel: i.accessed_channel,
    p_sendpulse: i.sendpulse_deposits,
    p_notes: i.notes,
    p_revenues: i.revenues,
  });
  if (error) throw error;
}

export async function deleteFunnel(id: string) {
  const { error } = await supabase.from('funnel_periods').delete().eq('id', id);
  if (error) throw error;
}

// ---------------- Importações (Etapa 2) ----------------

export interface ImportRow {
  id: string;
  period_id: string;
  source: Source;
  file_name: string;
  row_count: number;
  player_count: number;
  deposit_kind: 'first' | 'total';
  currency_rates: Record<string, number>;
  created_at: string;
}

export async function fetchImports(periodIds: string[]): Promise<ImportRow[]> {
  if (!periodIds.length) return [];
  const { data, error } = await supabase
    .from('imports')
    .select('id,period_id,source,file_name,row_count,player_count,deposit_kind,currency_rates,created_at')
    .in('period_id', periodIds)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ImportRow[];
}

/** Último mapeamento usado para esta casa + fonte (reutilização). */
export async function fetchSavedMapping(houseId: string, source: Source): Promise<ImportOptions | null> {
  const { data, error } = await supabase
    .from('imports')
    .select('mapping, periods!inner(house_id)')
    .eq('source', source)
    .eq('periods.house_id', houseId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0]?.mapping as ImportOptions) ?? null;
}

/** IDs desta fonte que já aparecem em outros períodos da mesma operação + casa. */
export async function fetchPlayersInOtherPeriods(operationId: string, houseId: string, source: Source, excludePeriodId?: string) {
  let q = supabase.from('periods').select('id').eq('operation_id', operationId).eq('house_id', houseId);
  if (excludePeriodId) q = q.neq('id', excludePeriodId);
  const { data: ps, error } = await q;
  if (error) throw error;
  const ids = (ps ?? []).map((p) => p.id as string);
  if (!ids.length) return new Set<string>();
  const out = new Set<string>();
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error: e } = await supabase
      .from('player_records')
      .select('player_id')
      .eq('source', source)
      .in('period_id', ids)
      .range(from, from + page - 1);
    if (e) throw e;
    (data ?? []).forEach((r) => out.add(r.player_id as string));
    if (!data || data.length < page) break;
  }
  return out;
}

export interface SaveImportInput {
  operationId: string;
  houseId: string;
  start: string;
  end: string;
  source: Source;
  fileName: string;
  fileHash: string;
  raw: string;
  options: ImportOptions;
  rowCount: number;
  records: PlayerRecord[];
  replace: boolean;
}

/** Grava tudo numa única transação no banco (tudo ou nada). Retorna o id do período. */
export async function saveImport(i: SaveImportInput): Promise<string> {
  const rates: Record<string, number> = {};
  Object.entries(i.options.rates).forEach(([k, v]) => {
    const n = parseRate(v);
    if (n != null) rates[k] = n;
  });
  const { data, error } = await supabase.rpc('save_import', {
    p_operation_id: i.operationId,
    p_house_id: i.houseId,
    p_start: i.start,
    p_end: i.end,
    p_source: i.source,
    p_file_name: i.fileName,
    p_file_hash: i.fileHash,
    p_raw: i.raw,
    p_mapping: i.options,
    p_deposit_kind: i.options.depositKind,
    p_rates: rates,
    p_row_count: i.rowCount,
    p_records: i.records,
    p_replace: i.replace,
  });
  if (error) throw error;
  return data as string;
}

export async function deleteImport(id: string) {
  const { error } = await supabase.from('imports').delete().eq('id', id);
  if (error) throw error;
}

// ---------------- Configurações ----------------
export const DEFAULT_TOLERANCE = 1;

export async function fetchTolerance(): Promise<number> {
  const { data, error } = await supabase.from('app_settings').select('tolerance_usd').maybeSingle();
  if (error) throw error;
  return data ? Number(data.tolerance_usd) : DEFAULT_TOLERANCE;
}

export async function saveTolerance(tolerance: number) {
  const { error } = await supabase.from('app_settings').upsert({ tolerance_usd: tolerance, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
  window.dispatchEvent(new Event('revwin:settings'));
}

// ---------------- Conferência (Etapa 3) ----------------

export interface ImportRecords {
  records: RecRecord[];
  rowsWithoutId: number; // linhas do arquivo que não viraram jogador (sem ID / resumo)
}

/** Registros individuais de uma importação (paginado) + linhas sem ID. */
export async function fetchImportRecords(imp: ImportRow): Promise<ImportRecords> {
  const out: RecRecord[] = [];
  let rawRows = 0;
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from('player_records')
      .select('player_id,deposit_amount,deposit_currency,deposit_usd,deposit_count,bets_usd,raw')
      .eq('import_id', imp.id)
      .order('player_id')
      .range(from, from + page - 1);
    if (error) throw error;
    (data ?? []).forEach((r: any) => {
      rawRows += Array.isArray(r.raw) ? r.raw.length : 1;
      out.push({
        player_id: r.player_id,
        deposit_amount: n(r.deposit_amount),
        deposit_currency: r.deposit_currency,
        deposit_usd: n(r.deposit_usd),
        deposit_count: r.deposit_count ?? 0,
        bets_usd: n(r.bets_usd),
      });
    });
    if (!data || data.length < page) break;
  }
  return { records: out, rowsWithoutId: Math.max(0, imp.row_count - rawRows) };
}

export interface ReconciliationRow {
  id: string;
  period_id: string;
  ia_import_id: string | null;
  house_import_id: string | null;
  tolerance_usd: number;
  rates: Record<string, number>;
  summary: RecSummary;
  items: RecItem[];
  qftd: number | null;
  baseline_count: number | null;
  divergences: number;
  updated_at: string;
}

const normRec = (r: any): ReconciliationRow => ({ ...r, tolerance_usd: Number(r.tolerance_usd) });

export async function fetchReconciliation(periodId: string): Promise<ReconciliationRow | null> {
  const { data, error } = await supabase.from('reconciliations').select('*').eq('period_id', periodId).maybeSingle();
  if (error) throw error;
  return data ? normRec(data) : null;
}

/** Resumo das conferências (sem a tabela de itens) para vários períodos. */
export async function fetchReconciliationSummaries(periodIds: string[]) {
  if (!periodIds.length) return [] as Omit<ReconciliationRow, 'items'>[];
  const { data, error } = await supabase
    .from('reconciliations')
    .select('id,period_id,ia_import_id,house_import_id,tolerance_usd,rates,summary,qftd,baseline_count,divergences,updated_at')
    .in('period_id', periodIds);
  if (error) throw error;
  return (data ?? []).map(normRec) as Omit<ReconciliationRow, 'items'>[];
}

export async function saveReconciliation(i: {
  periodId: string;
  iaImportId: string;
  houseImportId: string;
  tolerance: number;
  rates: Record<string, number>;
  summary: RecSummary;
  items: RecItem[];
}) {
  const { error } = await supabase.rpc('save_reconciliation', {
    p_period_id: i.periodId,
    p_ia_import_id: i.iaImportId,
    p_house_import_id: i.houseImportId,
    p_tolerance: i.tolerance,
    p_rates: i.rates,
    p_summary: i.summary,
    p_items: i.items,
    p_qftd: i.summary.qualified_count,
    p_baseline_count: i.summary.baseline_count,
    p_divergences: i.summary.divergences,
  });
  if (error) throw error;
}

/** Edita as informações manuais da casa no período (faturado e observações). */
export async function updateHousePeriodManual(id: string, v: { total_revenue_usd: number | null; notes: string | null }) {
  const { error } = await supabase.from('periods').update(v).eq('id', id);
  if (error) throw error;
}

export async function fetchPeriodById(id: string): Promise<Period | null> {
  const { data, error } = await supabase.from('periods').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? normalizePeriod(data) : null;
}

/** Exclui um período de casa sem importações (o banco recusa se houver CSV vinculado). */
export async function deleteHousePeriod(id: string) {
  const { error } = await supabase.from('periods').delete().eq('id', id);
  if (error) throw error;
}
