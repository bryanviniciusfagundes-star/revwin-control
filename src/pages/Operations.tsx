import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { deleteOperation, fetchHouses, fetchOperations, friendlyError, saveOperation } from '../lib/data';
import { STATUS_LABEL, type House, type Operation, type OperationStatus } from '../lib/types';
import { fmtUSD, parseNum } from '../lib/format';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner } from '../components/ui';

const statusTone = { ativa: 'emerald', pausada: 'amber', encerrada: 'zinc' } as const;

interface FormState {
  id?: string;
  name: string;
  expert: string;
  geo: string;
  baseline: string;
  cpa: string;
  status: OperationStatus;
  houses: string[];
}
const EMPTY: FormState = { name: '', expert: '', geo: '', baseline: '', cpa: '', status: 'ativa', houses: [] };

export default function Operations() {
  const [ops, setOps] = useState<Operation[]>([]);
  const [allHouses, setAllHouses] = useState<House[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState<FormState | null>(null);

  async function load() {
    try {
      const [o, h] = await Promise.all([fetchOperations(), fetchHouses()]);
      setOps(o);
      setAllHouses(h);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function remove(op: Operation) {
    if (!confirm(`Excluir a operação "${op.name}"?`)) return;
    setError('');
    try {
      await deleteOperation(op.id);
      await load();
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  const edit = (op: Operation) =>
    setForm({
      id: op.id,
      name: op.name,
      expert: op.expert ?? '',
      geo: op.geo,
      baseline: String(op.baseline_usd),
      cpa: String(op.cpa_usd),
      status: op.status,
      houses: op.houses.map((h) => h.name),
    });

  return (
    <>
      <PageHeader
        title="Operações"
        subtitle="Cadastre operações e as casas de apostas de cada uma."
        action={
          <Button onClick={() => setForm({ ...EMPTY })}>
            <Plus className="h-4 w-4" /> Nova operação
          </Button>
        }
      />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      <Card>
        {loading ? (
          <div className="flex justify-center py-14"><Spinner /></div>
        ) : ops.length === 0 ? (
          <Empty title="Nenhuma operação cadastrada">Crie a primeira operação para começar a registrar resultados.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Operação</th>
                  <th className="px-4 py-3 font-medium">GEO</th>
                  <th className="px-4 py-3 font-medium">Casas</th>
                  <th className="px-4 py-3 text-right font-medium">Baseline</th>
                  <th className="px-4 py-3 text-right font-medium">CPA</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {ops.map((op) => (
                  <tr key={op.id} className="hover:bg-zinc-800/30">
                    <td className="px-4 py-3">
                      <div className="font-medium">{op.name}</div>
                      {op.expert && <div className="text-xs text-zinc-500">Expert: {op.expert}</div>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{op.geo}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {op.houses.length ? op.houses.map((h) => <Badge key={h.id}>{h.name}</Badge>) : <span className="text-zinc-600">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtUSD(op.baseline_usd)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtUSD(op.cpa_usd)}</td>
                    <td className="px-4 py-3"><Badge tone={statusTone[op.status]}>{STATUS_LABEL[op.status]}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => edit(op)} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" aria-label="Editar">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => remove(op)} className="rounded-md p-1.5 text-zinc-400 hover:bg-red-950/60 hover:text-red-300" aria-label="Excluir">
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

      {form && (
        <OperationForm
          initial={form}
          allHouses={allHouses}
          onClose={() => setForm(null)}
          onSaved={async () => {
            setForm(null);
            await load();
          }}
        />
      )}
    </>
  );
}

function OperationForm({
  initial,
  allHouses,
  onClose,
  onSaved,
}: {
  initial: FormState;
  allHouses: House[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState(initial);
  const [houseDraft, setHouseDraft] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  function addHouse() {
    const name = houseDraft.trim();
    if (!name) return;
    if (!f.houses.some((h) => h.toLowerCase() === name.toLowerCase())) {
      // reaproveita a grafia já cadastrada, se existir
      const existing = allHouses.find((h) => h.name.toLowerCase() === name.toLowerCase());
      set('houses', [...f.houses, existing?.name ?? name]);
    }
    setHouseDraft('');
  }
  const onHouseKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addHouse();
    }
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const houses = houseDraft.trim() ? [...f.houses, houseDraft.trim()] : f.houses;
      if (!houses.length) throw new Error('Adicione pelo menos uma casa de apostas.');
      const baseline = parseNum(f.baseline, { label: 'Baseline', min: 0 });
      const cpa = parseNum(f.cpa, { label: 'CPA', min: 0 });
      if (baseline == null) throw new Error('Informe o baseline em USD.');
      if (cpa == null) throw new Error('Informe o CPA em USD.');
      setSaving(true);
      await saveOperation({
        id: f.id,
        name: f.name,
        expert: f.expert,
        geo: f.geo,
        baseline_usd: baseline,
        cpa_usd: cpa,
        status: f.status,
        houseNames: houses,
      });
      onSaved();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={f.id ? 'Editar operação' : 'Nova operação'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nome">
          <Input required value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Expert (opcional)">
            <Input value={f.expert} onChange={(e) => set('expert', e.target.value)} />
          </Field>
          <Field label="GEO">
            <Input required placeholder="CO" value={f.geo} onChange={(e) => set('geo', e.target.value)} />
          </Field>
          <Field label="Baseline (USD)">
            <Input inputMode="decimal" required placeholder="7.00" value={f.baseline} onChange={(e) => set('baseline', e.target.value)} />
          </Field>
          <Field label="CPA (USD)">
            <Input inputMode="decimal" required placeholder="30.00" value={f.cpa} onChange={(e) => set('cpa', e.target.value)} />
          </Field>
        </div>
        <Field label="Status">
          <Select value={f.status} onChange={(e) => set('status', e.target.value as OperationStatus)}>
            {(Object.keys(STATUS_LABEL) as OperationStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </Select>
        </Field>

        <Field label="Casas de apostas" hint="Digite e pressione Enter. Casas já cadastradas aparecem como sugestão.">
          <div className="flex gap-2">
            <Input list="houses-list" value={houseDraft} onChange={(e) => setHouseDraft(e.target.value)} onKeyDown={onHouseKey} placeholder="Ex.: Melbet" />
            <Button type="button" variant="ghost" onClick={addHouse}>Adicionar</Button>
          </div>
          <datalist id="houses-list">
            {allHouses.map((h) => <option key={h.id} value={h.name} />)}
          </datalist>
        </Field>
        {f.houses.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {f.houses.map((h) => (
              <span key={h} className="inline-flex items-center gap-1 rounded-md bg-zinc-800 py-1 pl-2.5 pr-1 text-xs">
                {h}
                <button type="button" onClick={() => set('houses', f.houses.filter((x) => x !== h))} className="rounded p-0.5 text-zinc-400 hover:text-zinc-100" aria-label={`Remover ${h}`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={saving}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}
