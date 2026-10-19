export type OperationStatus = 'ativa' | 'pausada' | 'encerrada';

export const STATUS_LABEL: Record<OperationStatus, string> = {
  ativa: 'Ativa',
  pausada: 'Pausada',
  encerrada: 'Encerrada',
};

export interface House {
  id: string;
  name: string;
}

export type BetsOperator = 'gt' | 'gte';
export const BETS_OPERATOR_LABEL: Record<BetsOperator, string> = { gt: '>', gte: '≥' };

/** Casa dentro de uma operação, com a regra de aposta para qualificar. */
export interface OperationHouse extends House {
  bets_operator: BetsOperator;
  bets_min_usd: number;
}

export interface Operation {
  id: string;
  name: string;
  expert: string | null;
  geo: string;
  baseline_usd: number;
  cpa_usd: number;
  status: OperationStatus;
  created_at: string;
  houses: OperationHouse[];
}

/** Valores ausentes são sempre null — nunca 0. */
export interface Period {
  id: string;
  operation_id: string;
  house_id: string;
  start_date: string; // yyyy-mm-dd
  end_date: string;
  // manuais
  leads: number | null;
  reached_pitch: number | null;
  accessed_channel: number | null;
  sendpulse_deposits: number | null;
  total_revenue_usd: number | null;
  notes: string | null;
  // vindos da importação (Etapas 2/3)
  registrations: number | null;
  ftd_ia: number | null;
  ftd_panel: number | null;
  qftd: number | null;
  deposits_sum_usd: number | null;
  created_at: string;
  updated_at: string;
}

export type NumericPeriodKey =
  | 'leads'
  | 'reached_pitch'
  | 'accessed_channel'
  | 'sendpulse_deposits'
  | 'total_revenue_usd'
  | 'registrations'
  | 'ftd_ia'
  | 'ftd_panel'
  | 'qftd'
  | 'deposits_sum_usd';
