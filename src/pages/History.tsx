import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { fetchImports, fetchOperations, fetchPeriods, fetchReconciliationSummaries, friendlyError, type ImportRow } from '../lib/data';
import type { Operation, Period } from '../lib/types';
import { fmtInt, fmtRange, fmtUSD, localISO } from '../lib/format';
import { Alert, Badge, Card, Empty, Field, Input, PageHeader, Select, Spinner } from '../components/ui';

type Rec = Awaited<ReturnType<typeof fetchReconciliationSummaries>>[number];

export function reconState(rec: Rec | undefined, imports: ImportRow[], periodId: string) {
  const ia = imports.find((i) => i.period_id === periodId && i.source === 'ia');
  const house = imports.find((i) => i.period_id === periodId && i.source === 'house');
  if (!rec) return ia && house ? 'pending' : 'missing';
  return rec.ia_import_id === ia?.id && rec.house_import_id === house?.id ? 'current' : 'stale';
}

export default function History() {
  const nav = useNavigate();
  const [ops, setOps] = useState<Operation[]>([]);
  const [rows, setRows] = useState<Period[]>([]);
  const [recs, setRecs] = useState<Rec[]>([]);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [opId, setOpId] = useState('');
  const [houseId, setHouseId] = useState('');
  const [from, setFrom] = useState(localISO(-365));
  const [to, setTo] = useState(localISO(0));

  useEffect(() => {
    fetchOperations().then(setOps).catch((e) => setError(friendlyError(e)));
  }, []);

  useEffect(() => {
    if (from && to && to < from) return;
    setLoading(true);
    fetchPeriods({ operationId: opId || undefined, houseId: houseId || undefined, from, to, newestFirst: true })
      .then(async (ps) => {
        const ids = ps.map((p) => p.id);
        const [r, i] = await Promise.all([fetchReconciliationSummaries(ids), fetchImports(ids)]);
        setRows(ps);
        setRecs(r);
        setImports(i);
      })
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoading(false));
  }, [opId, houseId, from, to]);

  const opById = useMemo(() => new Map(ops.map((o) => [o.id, o])), [ops]);
  const houses = useMemo(() => {
    const m = new Map<string, string>();
    (opId ? ops.filter((o) => o.id === opId) : ops).forEach((o) => o.houses.forEach((h) => m.set(h.id, h.name)));
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [ops, opId]);
  const houseName = (p: Period) => opById.get(p.operation_id)?.houses.find((h) => h.id === p.house_id)?.name ?? '—';

  return (
    <>
      <PageHeader title="Histórico" subtitle="Relatórios por operação, casa e período. Clique para abrir a conferência e editar as informações manuais." />

      <Card className="mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Operação">
          <Select value={opId} onChange={(e) => { setOpId(e.target.value); setHouseId(''); }}>
            <option value="">Todas</option>
            {ops.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        </Field>
        <Field label="Casa">
          <Select aria-label="Filtro casa" value={houseId} onChange={(e) => setHouseId(e.target.value)}>
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

      <Card>
        {loading ? (
          <div className="flex justify-center py-14"><Spinner /></div>
        ) : rows.length === 0 ? (
          <Empty title="Nenhum relatório neste período">
            Os relatórios aparecem quando você importa CSVs em <Link to="/importar" className="text-emerald-400 hover:underline">Importar e Conferir</Link> ou registra o faturado de uma casa.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Período</th>
                  <th className="px-4 py-3 font-medium">Operação / Casa</th>
                  <th className="px-4 py-3 text-right font-medium">FTD IA</th>
                  <th className="px-4 py-3 text-right font-medium">FTD painel</th>
                  <th className="px-4 py-3 text-right font-medium">QFTD</th>
                  <th className="px-4 py-3 text-right font-medium">Depósitos</th>
                  <th className="px-4 py-3 text-right font-medium">Divergências</th>
                  <th className="px-4 py-3 font-medium">Observações</th>
                  <th className="px-2 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {rows.map((p) => {
                  const rec = recs.find((r) => r.period_id === p.id);
                  const state = reconState(rec, imports, p.id);
                  return (
                    <tr key={p.id} onClick={() => nav(`/historico/${p.id}`)} className="cursor-pointer hover:bg-zinc-800/40">
                      <td className="whitespace-nowrap px-4 py-3">{fmtRange(p.start_date, p.end_date)}</td>
                      <td className="px-4 py-3">
                        <div>{opById.get(p.operation_id)?.name ?? '—'}</div>
                        <div className="text-xs text-zinc-500">{houseName(p)}</div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtInt(p.ftd_ia)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtInt(p.ftd_panel)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtInt(p.qftd)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{fmtUSD(p.deposits_sum_usd)}</td>
                      <td className="px-4 py-3 text-right">
                        {state === 'current' || state === 'stale' ? (
                          <span className="inline-flex items-center gap-2">
                            {state === 'stale' && <Badge tone="amber">desatualizada</Badge>}
                            <span className={`tabular-nums ${rec!.divergences ? 'text-red-300' : ''}`}>{fmtInt(rec!.divergences)}</span>
                          </span>
                        ) : state === 'pending' ? (
                          <Badge tone="amber">não conferido</Badge>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="max-w-56 truncate px-4 py-3 text-zinc-400">{p.notes ?? '—'}</td>
                      <td className="px-2 py-3 text-zinc-600"><ChevronRight className="h-4 w-4" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
