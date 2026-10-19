import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchFunnelPeriods, fetchOperations, fetchPeriods, friendlyError } from '../lib/data';
import type { FunnelPeriod, Operation, Period } from '../lib/types';
import { RATES, computeTotals, type Totals } from '../lib/metrics';
import { fmtInt, fmtPct, fmtRange, fmtShortDate, fmtUSD, localISO } from '../lib/format';
import { Alert, Card, Empty, Field, Input, PageHeader, Select, Spinner } from '../components/ui';

const COUNTS: { key: keyof Totals; label: string; funnel?: boolean }[] = [
  { key: 'leads', label: 'Leads', funnel: true },
  { key: 'reached_pitch', label: 'Chegou ao pitch', funnel: true },
  { key: 'registrations', label: 'Registros' },
  { key: 'ftd_ia', label: 'FTD IA' },
  { key: 'ftd_panel', label: 'FTD painel' },
  { key: 'qftd', label: 'QFTD' },
  { key: 'accessed_channel', label: 'Acessou canal', funnel: true },
];

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1.5 font-mono text-2xl tabular-nums ${accent ? 'text-emerald-400' : ''}`}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-zinc-600">{hint}</div>}
    </Card>
  );
}

/** Soma que preserva ausência: null + null = null. */
const addNullable = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : a + b);

export default function Dashboard() {
  const [ops, setOps] = useState<Operation[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [funnels, setFunnels] = useState<FunnelPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [opId, setOpId] = useState('');
  const [houseId, setHouseId] = useState('');
  const [from, setFrom] = useState(localISO(-89));
  const [to, setTo] = useState(localISO(0));

  useEffect(() => {
    fetchOperations().then(setOps).catch((e) => setError(friendlyError(e)));
  }, []);

  useEffect(() => {
    if (from && to && to < from) return;
    setLoading(true);
    setError('');
    Promise.all([
      fetchPeriods({ operationId: opId || undefined, houseId: houseId || undefined, from, to }),
      fetchFunnelPeriods({ operationId: opId || undefined, from, to }),
    ])
      .then(([p, f]) => {
        setPeriods(p);
        setFunnels(f);
      })
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoading(false));
  }, [opId, houseId, from, to]);

  // Casas disponíveis no filtro: da operação escolhida ou de todas
  const houses = useMemo(() => {
    const src = opId ? ops.filter((o) => o.id === opId) : ops;
    const m = new Map<string, string>();
    src.forEach((o) => o.houses.forEach((h) => m.set(h.id, h.name)));
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [ops, opId]);

  const chart = useMemo(() => {
    const groups = new Map<string, { label: string; ftd: number | null; qftd: number | null; start: string }>();
    periods.forEach((p) => {
      const k = `${p.start_date}|${p.end_date}`;
      const g = groups.get(k) ?? { label: `${fmtShortDate(p.start_date)}–${fmtShortDate(p.end_date)}`, ftd: null, qftd: null, start: p.start_date };
      g.ftd = addNullable(g.ftd, p.ftd_ia);
      g.qftd = addNullable(g.qftd, p.qftd);
      groups.set(k, g);
    });
    return [...groups.values()].sort((a, b) => a.start.localeCompare(b.start));
  }, [periods]);
  const hasChartData = chart.some((c) => c.ftd != null || c.qftd != null);
  // filtrando por casa, o funil (que é da operação) não se aplica
  const funnelRows = houseId ? null : funnels;
  const totals = computeTotals(funnelRows, periods);
  const isEmpty = periods.length === 0 && (funnelRows?.length ?? 0) === 0;
  const noImportYet = !isEmpty && periods.every((p) => p.ftd_ia == null && p.ftd_panel == null);

  return (
    <>
      <PageHeader title="Dashboard" subtitle={from && to ? `Períodos que cruzam ${fmtRange(from, to)}` : undefined} />

      <Card className="mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Operação">
          <Select value={opId} onChange={(e) => { setOpId(e.target.value); setHouseId(''); }}>
            <option value="">Todas</option>
            {ops.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        </Field>
        <Field label="Casa">
          <Select value={houseId} onChange={(e) => setHouseId(e.target.value)}>
            <option value="">Todas</option>
            {houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </Select>
        </Field>
        <Field label="De">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Até">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </Card>

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {to < from && <div className="mb-4"><Alert>A data final é anterior à inicial.</Alert></div>}

      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : isEmpty ? (
        <Card><Empty title="Nenhum registro neste período">Ajuste os filtros ou registre resultados.</Empty></Card>
      ) : (
        <>
          {(noImportYet || houseId) && (
            <div className="mb-4 space-y-2">
              {noImportYet && <Alert kind="info">Registros, FTDs, QFTD e depósitos aparecem como "—" até a importação dos CSVs das casas.</Alert>}
              {houseId && <Alert kind="info">Leads, pitch, canal e SendPulse são da operação inteira e não aparecem no filtro por casa.</Alert>}
            </div>
          )}

          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Funil</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {COUNTS.map((c) => (
              <Stat key={c.key} label={c.label} value={fmtInt(totals[c.key])} hint={c.funnel ? 'operação' : 'soma das casas'} />
            ))}
          </div>

          <h2 className="mb-3 mt-6 text-xs font-medium uppercase tracking-wider text-zinc-500">Conversão</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {RATES.map((r) => (
              <Stat key={r.key} label={r.label} value={fmtPct(r.calc(totals, funnelRows, periods))} hint={r.hint} />
            ))}
          </div>

          <h2 className="mb-3 mt-6 text-xs font-medium uppercase tracking-wider text-zinc-500">Financeiro</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Soma de depósitos" value={fmtUSD(totals.deposits_sum_usd)} />
            <Stat label="Total faturado" value={fmtUSD(totals.total_revenue_usd)} accent />
          </div>

          <Card className="mt-6 p-4">
            <h2 className="mb-4 text-sm font-medium text-zinc-300">Evolução de FTD IA e QFTD</h2>
            {hasChartData ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chart} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                    <CartesianGrid stroke="#27272a" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#3f3f46' }} />
                    <YAxis allowDecimals={false} tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: '#a1a1aa' }}
                      formatter={(v) => (v == null ? '—' : v)}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="ftd" name="FTD IA" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                    <Line type="monotone" dataKey="qftd" name="QFTD" stroke="#60a5fa" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Empty title="Sem dados de FTD ainda">O gráfico é preenchido após a importação dos CSVs.</Empty>
            )}
          </Card>
        </>
      )}
    </>
  );
}
