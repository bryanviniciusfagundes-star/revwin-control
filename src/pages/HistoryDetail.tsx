import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import {
  fetchFunnelPeriods,
  fetchImports,
  fetchOperations,
  fetchPeriodById,
  fetchReconciliation,
  friendlyError,
  updateHousePeriodManual,
  type ImportRow,
  type ReconciliationRow,
} from '../lib/data';
import { SOURCE_LABEL } from '../lib/csv';
import type { FunnelPeriod, Operation, Period } from '../lib/types';
import { fmtInt, fmtRange, fmtUSD, numToField, parseNum } from '../lib/format';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Spinner, Textarea } from '../components/ui';
import { RecSummaryView, RecTable } from '../components/RecView';
import { betsRuleText } from '../components/Reconciliation';
import { reconState } from './History';

export default function HistoryDetail() {
  const { id } = useParams();
  const [period, setPeriod] = useState<Period | null>(null);
  const [op, setOp] = useState<Operation | null>(null);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [rec, setRec] = useState<ReconciliationRow | null>(null);
  const [funnels, setFunnels] = useState<FunnelPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revenue, setRevenue] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState('');

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const p = await fetchPeriodById(id);
        if (!p) throw new Error('Relatório não encontrado.');
        const [ops, imps, r, fs] = await Promise.all([
          fetchOperations(),
          fetchImports([p.id]),
          fetchReconciliation(p.id),
          fetchFunnelPeriods({ operationId: p.operation_id, from: p.start_date, to: p.end_date }),
        ]);
        setPeriod(p);
        setOp(ops.find((o) => o.id === p.operation_id) ?? null);
        setImports(imps);
        setRec(r);
        setFunnels(fs);
        setRevenue(numToField(p.total_revenue_usd));
        setNotes(p.notes ?? '');
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!period) return;
    setError('');
    setOk('');
    try {
      const total = parseNum(revenue, { label: 'Total faturado' });
      setSaving(true);
      await updateHousePeriodManual(period.id, { total_revenue_usd: total, notes: notes.trim() || null });
      setPeriod({ ...period, total_revenue_usd: total, notes: notes.trim() || null });
      setOk('Informações salvas.');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (!period || !op)
    return (
      <>
        <Link to="/historico" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-100"><ArrowLeft className="h-4 w-4" /> Histórico</Link>
        <Alert>{error || 'Relatório não encontrado.'}</Alert>
      </>
    );

  const house = op.houses.find((h) => h.id === period.house_id);
  const state = reconState(rec ?? undefined, imports, period.id);
  const confLink = `/importar?op=${op.id}&house=${period.house_id}&start=${period.start_date}&end=${period.end_date}`;
  const exactFunnel = funnels.find((f) => f.start_date === period.start_date && f.end_date === period.end_date);

  return (
    <>
      <Link to="/historico" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-100"><ArrowLeft className="h-4 w-4" /> Histórico</Link>
      <PageHeader
        title={`${op.name} · ${house?.name ?? '—'}`}
        subtitle={fmtRange(period.start_date, period.end_date)}
        action={<Link to={confLink}><Button variant="ghost">Abrir em Importar e Conferir</Button></Link>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium text-zinc-300">Resumo</h2>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              ['FTD IA', fmtInt(period.ftd_ia)],
              ['FTD painel', fmtInt(period.ftd_panel)],
              ['QFTD', fmtInt(period.qftd)],
              ['Depósitos (casa)', fmtUSD(period.deposits_sum_usd)],
              ['Divergências', rec ? fmtInt(rec.divergences) : '—'],
              ['Total faturado', fmtUSD(period.total_revenue_usd)],
            ].map(([l, v]) => (
              <div key={l}>
                <div className="text-xs text-zinc-500">{l}</div>
                <div className="font-mono text-lg tabular-nums">{v}</div>
              </div>
            ))}
          </div>

          <h3 className="mb-2 mt-5 text-xs font-medium uppercase tracking-wider text-zinc-500">Arquivos importados</h3>
          {imports.length === 0 ? (
            <p className="text-sm text-zinc-500">Nenhum CSV importado neste período.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {imports.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2">
                  <FileText className="h-4 w-4 text-zinc-500" />
                  <Badge tone={i.source === 'ia' ? 'emerald' : 'amber'}>{SOURCE_LABEL[i.source]}</Badge>
                  <span className="truncate">{i.file_name}</span>
                  <span className="text-zinc-500">· {fmtInt(i.player_count)} jogadores · {new Date(i.created_at).toLocaleDateString('pt-BR')}</span>
                </li>
              ))}
            </ul>
          )}

          <h3 className="mb-2 mt-5 text-xs font-medium uppercase tracking-wider text-zinc-500">Funil da operação</h3>
          {funnels.length === 0 ? (
            <p className="text-sm text-zinc-500">Sem funil registrado nessas datas. <Link to="/resultados" className="text-emerald-400 hover:underline">Registrar</Link></p>
          ) : (
            <div className="space-y-1 text-sm">
              {funnels.map((f) => (
                <div key={f.id} className="flex flex-wrap gap-x-4 gap-y-1">
                  <span className="text-zinc-500">{fmtRange(f.start_date, f.end_date)}{f !== exactFunnel && ' (datas diferentes)'}</span>
                  <span>Leads {fmtInt(f.leads)}</span>
                  <span>Pitch {fmtInt(f.reached_pitch)}</span>
                  <span>Canal {fmtInt(f.accessed_channel)}</span>
                  <span>SendPulse {fmtInt(f.sendpulse_deposits)}</span>
                </div>
              ))}
              <p className="pt-1 text-xs text-zinc-500">O funil é da operação inteira; edite em <Link to="/resultados" className="text-emerald-400 hover:underline">Registrar Resultados</Link>.</p>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-medium text-zinc-300">Informações manuais da casa</h2>
          <form onSubmit={save} className="space-y-3">
            <Field label="Total faturado (USD)">
              <Input aria-label="Total faturado" inputMode="decimal" value={revenue} onChange={(e) => setRevenue(e.target.value)} />
            </Field>
            <Field label="Observações">
              <Textarea aria-label="Observações" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            {error && <Alert>{error}</Alert>}
            {ok && <Alert kind="success">{ok}</Alert>}
            <div className="flex justify-end">
              <Button type="submit" loading={saving}>Salvar</Button>
            </div>
          </form>
        </Card>
      </div>

      <div className="mt-8 space-y-4">
        {state === 'stale' && <Alert kind="info">Esta conferência usou importações que foram trocadas depois. <Link to={confLink} className="text-emerald-400 hover:underline">Abra e salve de novo</Link> para atualizar.</Alert>}
        {state === 'pending' && <Alert kind="info">Os dois CSVs estão importados, mas a conferência ainda não foi salva. <Link to={confLink} className="text-emerald-400 hover:underline">Conferir agora</Link></Alert>}
        {rec ? (
          <>
            <Card className="p-5">
              <h2 className="mb-1 font-medium">Conferência salva</h2>
              <p className="mb-4 text-xs text-zinc-500">
                {new Date(rec.updated_at).toLocaleString('pt-BR')} · baseline {fmtUSD(op.baseline_usd)} · {betsRuleText(op, period.house_id)}
                {Object.entries(rec.rates).map(([c, r]) => ` · US$ 1 = ${Number(r).toLocaleString('pt-BR')} ${c}`).join('')}
              </p>
              <RecSummaryView s={rec.summary} baselineUsd={op.baseline_usd} betsRule={betsRuleText(op, period.house_id)} toleranceUsd={rec.tolerance_usd} />
            </Card>
            <RecTable items={rec.items} fileName={`conferencia_${op.name}_${house?.name}_${period.start_date}_${period.end_date}.csv`.replace(/\s+/g, '-')} />
          </>
        ) : (
          state === 'missing' && <Alert kind="info">Sem conferência: importe os CSVs da IA e da casa deste período.</Alert>
        )}
      </div>
    </>
  );
}
