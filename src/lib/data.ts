import { supabase } from './supabase';
import type { House, Operation, OperationStatus, Period } from './types';
import { parseRate, type ImportOptions, type PlayerRecord, type Source } from './csv';

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
    .select('*, operation_houses(houses(id,name))')
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
      .map((oh: any) => oh.houses)
      .filter(Boolean)
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
  houseNames: string[];
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
  const names = [...new Map(input.houseNames.map((h) => [h.trim().toLowerCase(), h.trim()])).values()].filter(Boolean);
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
  if (toAdd.length) {
    const { error } = await supabase.from('operation_houses').insert(toAdd.map((house_id) => ({ operation_id: opId, house_id })));
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
    leads: n(p.leads),
    reached_pitch: n(p.reached_pitch),
    accessed_channel: n(p.accessed_channel),
    sendpulse_deposits: n(p.sendpulse_deposits),
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

export interface ManualPeriodInput {
  id?: string;
  operation_id: string;
  house_id: string;
  start_date: string;
  end_date: string;
  leads: number | null;
  reached_pitch: number | null;
  accessed_channel: number | null;
  sendpulse_deposits: number | null;
  total_revenue_usd: number | null;
  notes: string | null;
}

/** Salva somente os campos manuais — nunca sobrescreve dados vindos da importação. */
export async function saveManualPeriod(input: ManualPeriodInput) {
  const { id, ...payload } = input;
  if (id) {
    const { error } = await supabase.from('periods').update(payload).eq('id', id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('periods').insert(payload);
    if (error) throw error;
  }
}

export async function deletePeriod(id: string) {
  const { error } = await supabase.from('periods').delete().eq('id', id);
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
  created_at: string;
}

export async function fetchImports(periodIds: string[]): Promise<ImportRow[]> {
  if (!periodIds.length) return [];
  const { data, error } = await supabase
    .from('imports')
    .select('id,period_id,source,file_name,row_count,player_count,deposit_kind,created_at')
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
