import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import {
  fetchImportRecords,
  fetchReconciliation,
  fetchTolerance,
  friendlyError,
  saveReconciliation,
  type ImportRecords,
  type ImportRow,
  type ReconciliationRow,
} from '../lib/data';
import { parseRate } from '../lib/csv';
import { reconcile } from '../lib/recon';
import type { Operation, Period } from '../lib/types';
import { BETS_OPERATOR_LABEL } from '../lib/types';
import { fmtDate, fmtUSD } from '../lib/format';
import { Alert, Button, Card, Field, Input, Spinner } from './ui';
import { RecSummaryView, RecTable } from './RecView';

export function betsRuleText(op: Operation, houseId: string) {
  const h = op.houses.find((x) => x.id === houseId);
  return h ? `aposta ${BETS_OPERATOR_LABEL[h.bets_operator]} ${fmtUSD(h.bets_min_usd)}` : 'regra de aposta não definida';
}

export default function Reconciliation({ period, operation, houseId, imports, onSaved }: {
  period: Period;
  operation: Operation;
  houseId: string;
  imports: ImportRow[];
  onSaved: () => void;
}) {
  const iaImp = imports.find((i) => i.source === 'ia' && i.period_id === period.id);
  const houseImp = imports.find((i) => i.source === 'house' && i.period_id === period.id);
  const house = operation.houses.find((h) => h.id === houseId);

  const [ia, setIa] = useState<ImportRecords | null>(null);
  const [hs, setHs] = useState<ImportRecords | null>(null);
  const [tolerance, setTolerance] = useState<number | null>(null);
  const [saved, setSaved] = useState<ReconciliationRow | null>(null);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!iaImp || !houseImp) return;
    let alive = true;
    setIa(null);
    setHs(null);
    Promise.all([fetchImportRecords(iaImp), fetchImportRecords(houseImp), fetchTolerance(), fetchReconciliation(period.id)])
      .then(([a, b, t, r]) => {
        if (!alive) return;
        setIa(a);
        setHs(b);
        setTolerance(t);
        setSaved(r);
        // taxas: as da conferência salva (se ainda vale) ou as da importação da IA
        const base = r && r.ia_import_id === iaImp.id ? r.rates : iaImp.currency_rates ?? {};
        setRates(Object.fromEntries(Object.entries(base).map(([k, v]) => [k, String(v).replace('.', ',')])));
      })
      .catch((e) => alive && setError(friendlyError(e)));
    const onSettings = () => fetchTolerance().then((t) => alive && setTolerance(t));
    window.addEventListener('revwin:settings', onSettings);
    return () => {
      alive = false;
      window.removeEventListener('revwin:settings', onSettings);
    };
  }, [iaImp?.id, houseImp?.id, period.id]);

  const iaCurrencies = useMemo(
    () => [...new Set((ia?.records ?? []).map((r) => (r.deposit_currency ?? '').toUpperCase()).filter((c) => c && c !== 'USD'))].sort(),
    [ia],
  );
  const numericRates = useMemo(() => {
    const out: Record<string, number> = {};
    Object.entries(rates).forEach(([k, v]) => {
      const n = parseRate(v);
      if (n != null) out[k] = n;
    });
    return out;
  }, [rates]);

  const result = useMemo(() => {
    if (!ia || !hs || tolerance == null || !house || !iaImp || !houseImp) return null;
    return reconcile({
      ia: ia.records,
      house: hs.records,
      iaKind: iaImp.deposit_kind,
      houseKind: houseImp.deposit_kind,
      rowsWithoutIdIa: ia.rowsWithoutId,
      rowsWithoutIdHouse: hs.rowsWithoutId,
      baselineUsd: operation.baseline_usd,
      betsOperator: house.bets_operator,
      betsMinUsd: house.bets_min_usd,
      toleranceUsd: tolerance,
      iaRates: numericRates,
    });
  }, [ia, hs, tolerance, house, iaImp, houseImp, operation.baseline_usd, numericRates]);

  if (!iaImp || !houseImp)
    return (
      <Card className="p-5">
        <h2 className="font-medium">Conferência</h2>
        <p className="mt-1 text-sm text-zinc-500">Importe o CSV da IA e o CSV da casa neste período para conferir.</p>
      </Card>
    );

  const stale = saved && (saved.ia_import_id !== iaImp.id || saved.house_import_id !== houseImp.id);

  async function save() {
    if (!result || tolerance == null) return;
    setSaving(true);
    setError('');
    setOk('');
    try {
      await saveReconciliation({
        periodId: period.id,
        iaImportId: iaImp!.id,
        houseImportId: houseImp!.id,
        tolerance,
        rates: numericRates,
        summary: result.summary,
        items: result.items,
      });
      setSaved(await fetchReconciliation(period.id));
      setOk('Conferência salva. QFTD gravado no período.');
      onSaved();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">Conferência · {house?.name} · {fmtDate(period.start_date)} – {fmtDate(period.end_date)}</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Baseline {fmtUSD(operation.baseline_usd)} · {betsRuleText(operation, houseId)} · tolerância {fmtUSD(tolerance)} (altere em Configurações)
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saved && !stale && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-300">
                <CheckCircle2 className="h-4 w-4" /> Salva em {new Date(saved.updated_at).toLocaleString('pt-BR')}
              </span>
            )}
            <Button onClick={save} loading={saving} disabled={!result}>
              {saved ? <><RefreshCw className="h-4 w-4" /> Salvar de novo</> : 'Salvar conferência'}
            </Button>
          </div>
        </div>

        {stale && <div className="mb-4"><Alert kind="info">A conferência salva usou importações que foram trocadas. Salve de novo para atualizar.</Alert></div>}
        {error && <div className="mb-4"><Alert>{error}</Alert></div>}
        {ok && <div className="mb-4"><Alert kind="success">{ok}</Alert></div>}

        {iaCurrencies.length > 0 && (
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {iaCurrencies.map((c) => {
              const implied = result?.summary.implied_rates[c];
              return (
                <Field
                  key={c}
                  label={`Taxa da IA: quantos ${c} valem US$ 1`}
                  hint={implied ? `A casa converteu a ~${implied.rate.toLocaleString('pt-BR')} ${c} (${implied.pairs} jogadores com 1 depósito)` : 'Sem taxa: valores ficam sem conversão'}
                >
                  <div className="flex gap-2">
                    <Input aria-label={`Taxa conferência ${c}`} inputMode="decimal" value={rates[c] ?? ''} onChange={(e) => setRates({ ...rates, [c]: e.target.value })} />
                    {implied && (
                      <Button type="button" variant="ghost" className="shrink-0" onClick={() => setRates({ ...rates, [c]: String(implied.rate).replace('.', ',') })}>
                        Usar
                      </Button>
                    )}
                  </div>
                </Field>
              );
            })}
          </div>
        )}

        {!result ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : (
          <RecSummaryView s={result.summary} baselineUsd={operation.baseline_usd} betsRule={betsRuleText(operation, houseId)} toleranceUsd={tolerance ?? 0} />
        )}
      </Card>

      {result && (
        <RecTable
          items={result.items}
          fileName={`conferencia_${operation.name}_${house?.name}_${period.start_date}_${period.end_date}.csv`.replace(/\s+/g, '-')}
        />
      )}
    </div>
  );
}
