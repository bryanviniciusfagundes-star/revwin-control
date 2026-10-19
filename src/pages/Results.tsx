import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { deletePeriod, fetchOperations, fetchPeriods, friendlyError, saveManualPeriod } from '../lib/data';
import type { Operation, Period } from '../lib/types';
import { RATES, pct } from '../lib/metrics';
import { fmtInt, fmtPct, fmtRange, fmtUSD, localISO, numToField, parseNum } from '../lib/format';
import { Alert, Button, Card, Empty, Field, Input, PageHeader, Select, Spinner, Textarea } from '../components/ui';

interface FormState {
  id?: string;
  operation_id: string;
  house_id: string;
  start_date: string;
  end_date: string;
  leads: string;
  reached_pitch: string;
  accessed_channel: string;
  total_revenue: string;
  notes: string;
}

const blank = (): FormState => ({
  operation_id: '',
  house_id: '',
  start_date: localISO(-6),
  end_date: localISO(0),
  leads: '',
  reached_pitch: '',
  accessed_channel: '',
  total_revenue: '',
  notes: '',
});

export default function Results() {
  const [ops, setOps] = useState<Operation[]>([]);
  const [recent, setRecent] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState<FormState>(blank);
  const [editing, setEditing] = useState<Period | null>(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  async function load() {
    try {
      const [o, r] = await Promise.all([fetchOperations(), fetchPeriods({ newestFirst: true, limit: 12 })]);
      setOps(o);
      setRecent(r);
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
  const houseName = (opId: string, houseId: string) => opById.get(opId)?.houses.find((h) => h.id === houseId)?.name ?? '—';
  const selectedOp = opById.get(f.operation_id);
  const selectableOps = ops.filter((o) => o.status !== 'encerrada' || o.id === f.operation_id);

  // Prévia das porcentagens com os valores digitados + dados já importados (se editando)
  const preview = useMemo(() => {
    const safe = (s: string) => {
      const n = Number(s.replace(',', '.'));
      return s.trim() === '' || !Number.isFinite(n) ? null : n;
    };
    const row = {
      leads: safe(f.leads),
      reached_pitch: safe(f.reached_pitch),
      accessed_channel: safe(f.accessed_channel),
      registrations: editing?.registrations ?? null,
      ftd_ia: editing?.ftd_ia ?? null,
      qftd: editing?.qftd ?? null,
    } as Record<string, number | null>;
    return RATES.map((r) => ({ ...r, value: pct(row[r.num], row[r.den]) }));
  }, [f, editing]);

  function startEdit(p: Period) {
    setEditing(p);
    setOk('');
    setError('');
    setF({
      id: p.id,
      operation_id: p.operation_id,
      house_id: p.house_id,
      start_date: p.start_date,
      end_date: p.end_date,
      leads: numToField(p.leads),
      reached_pitch: numToField(p.reached_pitch),
      accessed_channel: numToField(p.accessed_channel),
      total_revenue: numToField(p.total_revenue_usd),
      notes: p.notes ?? '',
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
      if (!f.operation_id || !f.house_id) throw new Error('Selecione a operação e a casa.');
      if (f.end_date < f.start_date) throw new Error('A data final não pode ser anterior à inicial.');
      const leads = parseNum(f.leads, { label: 'Leads', integer: true, min: 0 });
      const reached = parseNum(f.reached_pitch, { label: 'Chegou ao pitch', integer: true, min: 0 });
      const channel = parseNum(f.accessed_channel, { label: 'Acessou canal', integer: true, min: 0 });
      const revenue = parseNum(f.total_revenue, { label: 'Total faturado' });
      if (leads != null && reached != null && reached > leads) throw new Error('"Chegou ao pitch" não pode ser maior que Leads.');
      setSaving(true);
      await saveManualPeriod({
        id: f.id,
        operation_id: f.operation_id,
        house_id: f.house_id,
        start_date: f.start_date,
        end_date: f.end_date,
        leads,
        reached_pitch: reached,
        accessed_channel: channel,
        total_revenue_usd: revenue,
        notes: f.notes.trim() || null,
      });
      setOk(f.id ? 'Registro atualizado.' : 'Registro salvo.');
      reset();
      await load();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: Period) {
    if (!confirm('Excluir este registro de período?')) return;
    try {
      await deletePeriod(p.id);
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
        subtitle="Indicadores manuais do período. FTDs, registros, QFTD e depósitos virão da importação dos CSVs."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <form onSubmit={submit} className="space-y-4">
            {editing && (
              <Alert kind="info">
                Editando o período {fmtRange(editing.start_date, editing.end_date)}.{' '}
                <button type="button" onClick={reset} className="text-emerald-400 hover:underline">Cancelar edição</button>
              </Alert>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Operação">
                <Select
                  required
                  value={f.operation_id}
                  onChange={(e) => {
                    const op = opById.get(e.target.value);
                    setF((s) => ({ ...s, operation_id: e.target.value, house_id: op?.houses.length === 1 ? op.houses[0].id : '' }));
                  }}
                >
                  <option value="">Selecione…</option>
                  {selectableOps.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Select>
              </Field>
              <Field label="Casa">
                <Select required value={f.house_id} onChange={(e) => set('house_id', e.target.value)} disabled={!selectedOp}>
                  <option value="">Selecione…</option>
                  {selectedOp?.houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </Select>
              </Field>
              <Field label="Data inicial">
                <Input type="date" required value={f.start_date} onChange={(e) => set('start_date', e.target.value)} />
              </Field>
              <Field label="Data final">
                <Input type="date" required value={f.end_date} onChange={(e) => set('end_date', e.target.value)} />
              </Field>
            </div>

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
              <Field label="Total faturado (USD)">
                <Input inputMode="decimal" value={f.total_revenue} onChange={(e) => set('total_revenue', e.target.value)} />
              </Field>
            </div>
            <p className="-mt-1 text-xs text-zinc-500">Campos em branco ficam como "não informado" — nunca são tratados como zero.</p>

            <Field label="Observações">
              <Textarea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>

            {error && <Alert>{error}</Alert>}
            {ok && <Alert kind="success">{ok}</Alert>}
            <div className="flex justify-end">
              <Button type="submit" loading={saving}>{editing ? 'Salvar alterações' : 'Salvar registro'}</Button>
            </div>
          </form>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-medium text-zinc-300">Porcentagens</h2>
          <p className="mt-1 text-xs text-zinc-500">Calculadas automaticamente.</p>
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
          <p className="mt-3 text-xs text-zinc-500">As taxas que dependem de FTD e Registros aparecem após a importação dos CSVs.</p>
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
                  <th className="px-4 py-3 font-medium">Operação / Casa</th>
                  <th className="px-4 py-3 text-right font-medium">Leads</th>
                  <th className="px-4 py-3 text-right font-medium">Pitch</th>
                  <th className="px-4 py-3 text-right font-medium">Canal</th>
                  <th className="px-4 py-3 text-right font-medium">Faturado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {recent.map((p) => (
                  <tr key={p.id} className={editing?.id === p.id ? 'bg-emerald-500/5' : 'hover:bg-zinc-800/30'}>
                    <td className="whitespace-nowrap px-4 py-3">{fmtRange(p.start_date, p.end_date)}</td>
                    <td className="px-4 py-3">
                      <div>{opById.get(p.operation_id)?.name ?? '—'}</div>
                      <div className="text-xs text-zinc-500">{houseName(p.operation_id, p.house_id)}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtInt(p.leads)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtInt(p.reached_pitch)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtInt(p.accessed_channel)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtUSD(p.total_revenue_usd)}</td>
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
