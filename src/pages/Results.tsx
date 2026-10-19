import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { deleteFunnel, fetchFunnelPeriods, fetchOperations, fetchPeriods, friendlyError, saveFunnel } from '../lib/data';
import type { FunnelPeriod, Operation, Period } from '../lib/types';
import { RATES, computeTotals, sumField } from '../lib/metrics';
import { fmtInt, fmtPct, fmtRange, fmtUSD, localISO, numToField, parseNum } from '../lib/format';
import { Alert, Button, Card, Empty, Field, Input, PageHeader, Select, Spinner, Textarea } from '../components/ui';

interface FormState {
  id?: string;
  operation_id: string;
  start_date: string;
  end_date: string;
  leads: string;
  reached_pitch: string;
  accessed_channel: string;
  sendpulse: string;
  notes: string;
  revenue: Record<string, string>; // house_id → texto
}

const blank = (): FormState => ({
  operation_id: '',
  start_date: localISO(-6),
  end_date: localISO(0),
  leads: '',
  reached_pitch: '',
  accessed_channel: '',
  sendpulse: '',
  notes: '',
  revenue: {},
});

const safeNum = (s: string) => {
  const n = Number(s.replace(',', '.'));
  return s.trim() === '' || !Number.isFinite(n) ? null : n;
};

export default function Results() {
  const [ops, setOps] = useState<Operation[]>([]);
  const [recent, setRecent] = useState<FunnelPeriod[]>([]);
  const [recentHouses, setRecentHouses] = useState<Period[]>([]);
  const [houseRows, setHouseRows] = useState<Period[]>([]); // períodos das casas com as datas do formulário
  const [housesReady, setHousesReady] = useState(false); // faturado já salvo foi carregado no formulário
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState<FormState>(blank);
  const [editing, setEditing] = useState<FunnelPeriod | null>(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  async function load() {
    try {
      const [o, r] = await Promise.all([fetchOperations(), fetchFunnelPeriods({ newestFirst: true, limit: 12 })]);
      setOps(o);
      setRecent(r);
      // faturado das casas nos mesmos períodos da lista
      if (r.length) {
        const min = r.reduce((a, x) => (x.start_date < a ? x.start_date : a), r[0].start_date);
        const max = r.reduce((a, x) => (x.end_date > a ? x.end_date : a), r[0].end_date);
        setRecentHouses(await fetchPeriods({ from: min, to: max }));
      } else setRecentHouses([]);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const opById = useMemo(() => new Map(ops.map((o) => [o.id, o])), [ops]);
  const selectedOp = opById.get(f.operation_id);
  const selectableOps = ops.filter((o) => o.status !== 'encerrada' || o.id === f.operation_id);
  const datesOk = !!f.start_date && !!f.end_date && f.end_date >= f.start_date;

  // carrega os dados das casas com exatamente essas datas (faturado já salvo + FTDs importados)
  useEffect(() => {
    setHousesReady(false);
    if (!f.operation_id || !datesOk) {
      setHouseRows([]);
      return;
    }
    let alive = true;
    fetchPeriods({ operationId: f.operation_id, from: f.start_date, to: f.end_date })
      .then((ps) => {
        if (!alive) return;
        const exact = ps.filter((p) => p.start_date === f.start_date && p.end_date === f.end_date);
        setHouseRows(exact);
        setF((s) => {
          const revenue = { ...s.revenue };
          exact.forEach((p) => {
            if (revenue[p.house_id] === undefined) revenue[p.house_id] = numToField(p.total_revenue_usd);
          });
          return { ...s, revenue };
        });
        setHousesReady(true);
      })
      .catch((e) => alive && setError(friendlyError(e)));
    return () => {
      alive = false;
    };
  }, [f.operation_id, f.start_date, f.end_date, datesOk, editing?.id]);

  const sameDates = (p: { operation_id: string; start_date: string; end_date: string }, x: FunnelPeriod) =>
    p.operation_id === x.operation_id && p.start_date === x.start_date && p.end_date === x.end_date;

  // porcentagens ao vivo: funil digitado + dados das casas com as mesmas datas
  const preview = useMemo(() => {
    const funnel = [{
      leads: safeNum(f.leads),
      reached_pitch: safeNum(f.reached_pitch),
      accessed_channel: safeNum(f.accessed_channel),
      sendpulse_deposits: safeNum(f.sendpulse),
    } as FunnelPeriod];
    const totals = computeTotals(funnel, houseRows);
    return RATES.map((r) => ({ ...r, value: r.calc(totals, funnel, houseRows) }));
  }, [f, houseRows]);

  function startEdit(p: FunnelPeriod) {
    setEditing(p);
    setOk('');
    setError('');
    setF({
      id: p.id,
      operation_id: p.operation_id,
      start_date: p.start_date,
      end_date: p.end_date,
      leads: numToField(p.leads),
      reached_pitch: numToField(p.reached_pitch),
      accessed_channel: numToField(p.accessed_channel),
      sendpulse: numToField(p.sendpulse_deposits),
      notes: p.notes ?? '',
      revenue: {},
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function reset() {
    setEditing(null);
    setF(blank());
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setOk('');
    try {
      if (!f.operation_id) throw new Error('Selecione a operação.');
      if (!datesOk) throw new Error('A data final não pode ser anterior à inicial.');
      const leads = parseNum(f.leads, { label: 'Leads', integer: true, min: 0 });
      const reached = parseNum(f.reached_pitch, { label: 'Chegou ao pitch', integer: true, min: 0 });
      const channel = parseNum(f.accessed_channel, { label: 'Acessou canal', integer: true, min: 0 });
      const sendpulse = parseNum(f.sendpulse, { label: 'Depósitos SendPulse', integer: true, min: 0 });
      if (leads != null && reached != null && reached > leads) throw new Error('"Chegou ao pitch" não pode ser maior que Leads.');
      const revenues = (selectedOp?.houses ?? []).map((h) => ({
        house_id: h.id,
        revenue: parseNum(f.revenue[h.id] ?? '', { label: `Total faturado (${h.name})` }),
      }));
      setSaving(true);
      await saveFunnel({
        id: f.id,
        operation_id: f.operation_id,
        start_date: f.start_date,
        end_date: f.end_date,
        leads,
        reached_pitch: reached,
        accessed_channel: channel,
        sendpulse_deposits: sendpulse,
        notes: f.notes.trim() || null,
        revenues,
      });
      setOk(f.id ? 'Registro atualizado.' : 'Registro salvo.');
      reset();
      await load();
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(
        code === '23P01'
          ? 'Já existe um registro desta operação com período sobreposto. Edite o registro existente ou use outras datas.'
          : friendlyError(err),
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: FunnelPeriod) {
    if (!confirm('Excluir este registro do funil? O faturado e as importações das casas não são apagados.')) return;
    try {
      await deleteFunnel(p.id);
      if (editing?.id === p.id) reset();
      await load();
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;

  if (!ops.length)
    return (
      <>
        <PageHeader title="Registrar Resultados" />
        <Card>
          <Empty title="Nenhuma operação cadastrada">
            Cadastre uma operação em <Link to="/operacoes" className="text-emerald-400 hover:underline">Operações</Link> primeiro.
          </Empty>
        </Card>
      </>
    );

  return (
    <>
      <PageHeader
        title="Registrar Resultados"
        subtitle="O funil é da operação inteira. O faturado é informado por casa. FTDs, registros e depósitos vêm da importação dos CSVs."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <form onSubmit={submit} className="space-y-5">
            {editing && (
              <Alert kind="info">
                Editando {opById.get(editing.operation_id)?.name} · {fmtRange(editing.start_date, editing.end_date)}. As datas de um registro salvo não mudam.{' '}
                <button type="button" onClick={reset} className="text-emerald-400 hover:underline">Cancelar edição</button>
              </Alert>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Operação">
                <Select
                  required
                  disabled={!!editing}
                  value={f.operation_id}
                  onChange={(e) => setF((s) => ({ ...s, operation_id: e.target.value, revenue: {} }))}
                >
                  <option value="">Selecione…</option>
                  {selectableOps.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Select>
              </Field>
              <Field label="Data inicial">
                <Input type="date" required disabled={!!editing} value={f.start_date} onChange={(e) => setF((s) => ({ ...s, start_date: e.target.value, revenue: {} }))} />
              </Field>
              <Field label="Data final">
                <Input type="date" required disabled={!!editing} value={f.end_date} onChange={(e) => setF((s) => ({ ...s, end_date: e.target.value, revenue: {} }))} />
              </Field>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium text-zinc-300">Funil da operação</h3>
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Leads">
                  <Input inputMode="numeric" value={f.leads} onChange={(e) => set('leads', e.target.value)} />
                </Field>
                <Field label="Chegou ao pitch">
                  <Input inputMode="numeric" value={f.reached_pitch} onChange={(e) => set('reached_pitch', e.target.value)} />
                </Field>
                <Field label="Acessou canal">
                  <Input inputMode="numeric" value={f.accessed_channel} onChange={(e) => set('accessed_channel', e.target.value)} />
                </Field>
                <Field label="Depósitos SendPulse" hint="Confirmados no SendPulse">
                  <Input inputMode="numeric" value={f.sendpulse} onChange={(e) => set('sendpulse', e.target.value)} />
                </Field>
              </div>
            </div>

            {selectedOp && (
              <div>
                <h3 className="mb-2 text-sm font-medium text-zinc-300">Total faturado por casa (USD)</h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  {selectedOp.houses.map((h) => (
                    <Field key={h.id} label={h.name}>
                      <Input
                        aria-label={`Faturado ${h.name}`}
                        inputMode="decimal"
                        value={f.revenue[h.id] ?? ''}
                        onChange={(e) => set('revenue', { ...f.revenue, [h.id]: e.target.value })}
                      />
                    </Field>
                  ))}
                </div>
              </div>
            )}
            <p className="-mt-1 text-xs text-zinc-500">Campos em branco ficam como "não informado" — nunca são tratados como zero.</p>

            <Field label="Observações">
              <Textarea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>

            {error && <Alert>{error}</Alert>}
            {ok && <Alert kind="success">{ok}</Alert>}
            <div className="flex justify-end">
              <Button type="submit" loading={saving} disabled={!!f.operation_id && datesOk && !housesReady}>
                {editing ? 'Salvar alterações' : 'Salvar registro'}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-medium text-zinc-300">Porcentagens</h2>
          <p className="mt-1 text-xs text-zinc-500">Funil digitado + soma das casas no mesmo período.</p>
          <div className="mt-4 space-y-3">
            {preview.map((r) => (
              <div key={r.key} className="flex items-baseline justify-between gap-3 border-b border-zinc-800/70 pb-3 last:border-0">
                <div>
                  <div className="text-sm">{r.label}</div>
                  <div className="text-xs text-zinc-500">{r.hint}</div>
                </div>
                <div className="font-mono text-lg tabular-nums">{fmtPct(r.value)}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-zinc-500">As taxas que dependem de FTD e Registros aparecem após a importação dos CSVs das casas.</p>
        </Card>
      </div>

      <h2 className="mb-3 mt-10 text-sm font-medium text-zinc-300">Últimos registros</h2>
      <Card>
        {recent.length === 0 ? (
          <Empty title="Nenhum registro ainda" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Período</th>
                  <th className="px-4 py-3 font-medium">Operação</th>
                  <th className="px-4 py-3 text-right font-medium">Leads</th>
                  <th className="px-4 py-3 text-right font-medium">Pitch</th>
                  <th className="px-4 py-3 text-right font-medium">Canal</th>
                  <th className="px-4 py-3 text-right font-medium">SendPulse</th>
                  <th className="px-4 py-3 text-right font-medium">Faturado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {recent.map((p) => {
                  const houses = recentHouses.filter((h) => sameDates(h, p));
                  return (
                    <tr key={p.id} className={editing?.id === p.id ? 'bg-emerald-500/5' : 'hover:bg-zinc-800/30'}>
                      <td className="whitespace-nowrap px-4 py-3">{fmtRange(p.start_date, p.end_date)}</td>
                      <td className="px-4 py-3">{opById.get(p.operation_id)?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtInt(p.leads)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtInt(p.reached_pitch)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtInt(p.accessed_channel)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtInt(p.sendpulse_deposits)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{fmtUSD(sumField(houses, 'total_revenue_usd'))}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => startEdit(p)} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" aria-label="Editar">
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button onClick={() => remove(p)} className="rounded-md p-1.5 text-zinc-400 hover:bg-red-950/60 hover:text-red-300" aria-label="Excluir">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
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
