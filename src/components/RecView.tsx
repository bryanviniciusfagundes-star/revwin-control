import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { STATUS_LABEL, itemsToCsv, type ItemStatus, type RecItem, type RecSummary } from '../lib/recon';
import { fmtInt, fmtUSD } from '../lib/format';
import { Badge, Button, Card, Input, Select, cx } from './ui';

const tone: Record<ItemStatus, 'emerald' | 'amber' | 'red' | 'zinc'> = {
  ok: 'emerald',
  divergence: 'red',
  not_comparable: 'zinc',
  house_no_deposit: 'amber',
  only_ia: 'amber',
  only_house: 'zinc',
};

function Box({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: 'red' | 'emerald' | 'amber' }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5">
      <div className="text-[11px] leading-tight text-zinc-500">{label}</div>
      <div className={cx('mt-1 font-mono text-xl tabular-nums', accent === 'red' && 'text-red-300', accent === 'emerald' && 'text-emerald-300', accent === 'amber' && 'text-amber-300')}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] leading-tight text-zinc-600">{hint}</div>}
    </div>
  );
}

export function RecSummaryView({ s, baselineUsd, betsRule, toleranceUsd }: { s: RecSummary; baselineUsd: number; betsRule: string; toleranceUsd: number }) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Conferência de FTDs</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Box label="FTDs na IA" value={fmtInt(s.ftd_ia)} />
          <Box label="FTDs no painel" value={fmtInt(s.ftd_house)} />
          <Box label="IDs nas duas fontes" value={fmtInt(s.in_both)} accent="emerald" />
          <Box label="Casa não mostra depósito" value={fmtInt(s.house_no_deposit)} hint="ID existe na casa" accent={s.house_no_deposit ? 'amber' : undefined} />
          <Box label="Só na IA" value={fmtInt(s.only_ia)} hint="ID não encontrado na casa" accent={s.only_ia ? 'amber' : undefined} />
          <Box label="Só na casa" value={fmtInt(s.only_house)} hint="ID não encontrado na IA" />
          <Box label="Sem ID (não comparados)" value={fmtInt(s.rows_without_id_ia + s.rows_without_id_house)} hint={`IA ${s.rows_without_id_ia} · casa ${s.rows_without_id_house}`} />
        </div>
        <p className="mt-2 text-xs text-zinc-500">IDs que não se encontram não são tratados como jogadores diferentes — podem ser a mesma pessoa com ID digitado ou registrado de outra forma.</p>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Conferência de baseline (dados da casa)</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Box label={`Depositaram ≥ ${fmtUSD(baselineUsd)}`} value={fmtInt(s.baseline_count)} hint="soma dos depósitos" />
          <Box label="Qualificados (QFTD)" value={fmtInt(s.qualified_count)} hint={`baseline e ${betsRule}`} accent="emerald" />
          <Box label="Baseline sem cumprir aposta" value={fmtInt(s.baseline_without_bets)} />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Conferência de valores (tolerância {fmtUSD(toleranceUsd)})</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Box label="Comparados" value={fmtInt(s.compared)} />
          <Box label="Divergências" value={fmtInt(s.divergences)} accent={s.divergences ? 'red' : 'emerald'} />
          <Box label="Não comparáveis" value={fmtInt(s.not_comparable)} hint="totais com vários depósitos ou sem conversão" />
        </div>
      </div>
    </div>
  );
}

const FILTERS: { value: string; label: string; match: (i: RecItem) => boolean }[] = [
  { value: 'problems', label: 'Divergências e não reconhecidos', match: (i) => ['divergence', 'house_no_deposit', 'only_ia'].includes(i.status) },
  { value: 'all', label: 'Todos', match: () => true },
  ...(Object.keys(STATUS_LABEL) as ItemStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s], match: (i: RecItem) => i.status === s })),
];

export function RecTable({ items, fileName }: { items: RecItem[]; fileName: string }) {
  const [filter, setFilter] = useState('problems');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(100);
  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.value === filter)!;
    const t = q.trim();
    return items
      .filter((i) => f.match(i) && (!t || i.player_id.includes(t)))
      .sort((a, b) => Math.abs(b.diff_usd ?? 0) - Math.abs(a.diff_usd ?? 0) || a.player_id.localeCompare(b.player_id));
  }, [items, filter, q]);

  function exportCsv() {
    const blob = new Blob([itemsToCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3 border-b border-zinc-800 p-4">
        <div className="min-w-48 flex-1">
          <Select aria-label="Filtrar status" value={filter} onChange={(e) => { setFilter(e.target.value); setLimit(100); }}>
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label} ({items.filter(f.match).length})
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Input aria-label="Buscar ID" placeholder="Buscar ID" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button variant="ghost" onClick={exportCsv} disabled={!rows.length}>
          <Download className="h-4 w-4" /> Exportar CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-800 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">ID do jogador</th>
              <th className="px-4 py-2.5 text-right font-medium">Depósito IA</th>
              <th className="px-4 py-2.5 text-right font-medium">Depósito casa</th>
              <th className="px-4 py-2.5 text-right font-medium">Diferença</th>
              <th className="px-4 py-2.5 text-right font-medium">Apostado</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {rows.slice(0, limit).map((i) => (
              <tr key={i.status + i.player_id} className="align-top hover:bg-zinc-800/30">
                <td className="px-4 py-2.5 font-mono text-xs">{i.player_id}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                  {fmtUSD(i.ia_usd)}
                  {i.ia_deposit != null && i.ia_currency && i.ia_currency !== 'USD' && (
                    <div className="text-[11px] text-zinc-500">{i.ia_deposit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} {i.ia_currency}</div>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                  {fmtUSD(i.house_usd)}
                  {i.house_count != null && i.house_count > 1 && <div className="text-[11px] text-zinc-500">{i.house_count} depósitos</div>}
                </td>
                <td className={cx('whitespace-nowrap px-4 py-2.5 text-right tabular-nums', i.status === 'divergence' && 'text-red-300')}>
                  {i.diff_usd == null ? '—' : (i.diff_usd > 0 ? '+' : '') + fmtUSD(i.diff_usd)}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{fmtUSD(i.bets_usd)}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={tone[i.status]}>{STATUS_LABEL[i.status]}</Badge>
                  {i.reason && <div className="mt-1 text-[11px] text-zinc-500">{i.reason}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-8 text-center text-sm text-zinc-500">Nenhum jogador neste filtro.</p>}
        {rows.length > limit && (
          <div className="border-t border-zinc-800 p-3 text-center">
            <Button variant="ghost" onClick={() => setLimit((l) => l + 200)}>Mostrar mais ({fmtInt(rows.length - limit)} restantes)</Button>
          </div>
        )}
      </div>
    </Card>
  );
}
