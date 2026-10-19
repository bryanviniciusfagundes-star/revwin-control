import { supabase } from './supabase';
import type { House, Operation, OperationStatus, Period } from './types';

/** Traduz erros do banco para mensagens claras. */
export function friendlyError(e: unknown): string {
  const err = e as { code?: string; message?: string };
  switch (err?.code) {
    case '23505':
      return 'Já existe um registro com esse nome.';
    case '23P01':
      return 'Já existe um registro dessa operação e casa com período sobreposto. Edite o registro existente.';
    case '23503':
      return 'Não é possível excluir: existem resultados vinculados. Altere o status para "Encerrada".';
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
