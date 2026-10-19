import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileText, Trash2, Upload } from 'lucide-react';
import {
  deleteImport,
  fetchImports,
  fetchOperations,
  fetchPeriods,
  fetchPlayersInOtherPeriods,
  fetchSavedMapping,
  friendlyError,
  saveImport,
  type ImportRow,
} from '../lib/data';
import {
  FIELDS,
  SOURCE_LABEL,
  normalize,
  parseRate,
  readCsvFile,
  suggestColumns,
  type ImportOptions,
  type ParsedFile,
  type Source,
} from '../lib/csv';
import type { Operation, Period } from '../lib/types';
import { fmtDate, fmtInt, fmtRange, fmtUSD, localISO } from '../lib/format';
import { Alert, Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Spinner, cx } from '../components/ui';

interface Ctx {
  operation: Operation;
  houseId: string;
  start: string;
  end: string;
  period: Period | null; // período com as mesmas datas, se já existir
}

const DEFAULT_OPTIONS = (): ImportOptions => ({
  columns: {},
  depositKind: 'first',
  decimal: 'auto',
  dateFormat: 'auto',
  fileCurrency: 'USD',
  rates: {},
});

export default function ImportPage() {
  const [ops, setOps] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [opId, setOpId] = useState('');
  const [houseId, setHouseId] = useState('');
  const [start, setStart] = useState(localISO(-6));
  const [end, setEnd] = useState(localISO(0));
  const [overlapping, setOverlapping] = useState<Period[]>([]);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [checking, setChecking] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    fetchOperations()
      .then(setOps)
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoading(false));
  }, []);

  const op = ops.find((o) => o.id === opId);
  const datesOk = !!start && !!end && end >= start;

  // períodos que cruzam as datas escolhidas (mesma operação + casa)
  useEffect(() => {
    if (!opId || !houseId || !datesOk) {
      setOverlapping([]);
      setImports([]);
      return;
    }
    setChecking(true);
    fetchPeriods({ operationId: opId, houseId, from: start, to: end })
      .then(async (ps) => {
        setOverlapping(ps);
        setImports(await fetchImports(ps.map((p) => p.id)));
      })
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setChecking(false));
  }, [opId, houseId, start, end, datesOk, tick]);

  const exact = overlapping.find((p) => p.start_date === start && p.end_date === end) ?? null;
  const conflict = overlapping.find((p) => p !== exact);
  const ctx: Ctx | null = op && houseId && datesOk && !conflict ? { operation: op, houseId, start, end, period: exact } : null;
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  async function removeImport(i: ImportRow) {
    if (!confirm(`Excluir a importação "${i.file_name}"? Os registros individuais dela serão apagados.`)) return;
    try {
      await deleteImport(i.id);
      refresh();
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (!ops.length)
    return (
      <>
        <PageHeader title="Importar e Conferir" />
        <Card>
          <Empty title="Nenhuma operação cadastrada">
            Cadastre uma operação em <Link to="/operacoes" className="text-emerald-400 hover:underline">Operações</Link> primeiro.
          </Empty>
        </Card>
      </>
    );

  return (
    <>
      <PageHeader title="Importar e Conferir" subtitle="Envie o CSV da IA e o CSV da casa para o período. A conferência entre os dois vem na Etapa 3." />

      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Operação">
          <Select value={opId} onChange={(e) => {
            const o = ops.find((x) => x.id === e.target.value);
            setOpId(e.target.value);
            setHouseId(o?.houses.length === 1 ? o.houses[0].id : '');
          }}>
            <option value="">Selecione…</option>
            {ops.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        </Field>
        <Field label="Casa">
          <Select value={houseId} onChange={(e) => setHouseId(e.target.value)} disabled={!op}>
            <option value="">Selecione…</option>
            {op?.houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </Select>
        </Field>
        <Field label="Data inicial">
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Data final">
          <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </Card>

      <div className="mb-6 space-y-2">
        {!datesOk && <Alert>A data final não pode ser anterior à inicial.</Alert>}
        {checking && <div className="flex items-center gap-2 text-sm text-zinc-500"><Spinner className="h-4 w-4" /> Verificando período…</div>}
        {!checking && conflict && (
          <Alert>
            Já existe um período {fmtRange(conflict.start_date, conflict.end_date)} para esta operação e casa que se sobrepõe às datas escolhidas.
            Use exatamente as mesmas datas ou escolha datas que não se cruzem.
          </Alert>
        )}
        {!checking && ctx && (
          <Alert kind="info">
            {exact
              ? <>Os dados serão vinculados ao período já registrado {fmtRange(start, end)}.</>
              : <>Será criado o período {fmtRange(start, end)}. Leads, pitch e demais campos manuais podem ser preenchidos depois em Registrar Resultados.</>}
          </Alert>
        )}
        {error && <Alert>{error}</Alert>}
      </div>

      {ctx && imports.length > 0 && (
        <Card className="mb-6">
          <div className="border-b border-zinc-800 px-4 py-3 text-sm font-medium text-zinc-300">Importações deste período</div>
          <div className="divide-y divide-zinc-800/70">
            {imports.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <FileText className="h-4 w-4 text-zinc-500" />
                <Badge tone={i.source === 'ia' ? 'emerald' : 'amber'}>{SOURCE_LABEL[i.source]}</Badge>
                <span className="min-w-0 flex-1 truncate">{i.file_name}</span>
                <span className="text-zinc-500">{fmtInt(i.player_count)} jogadores · {fmtInt(i.row_count)} linhas</span>
                <span className="text-zinc-500">{new Date(i.created_at).toLocaleString('pt-BR')}</span>
                <button onClick={() => removeImport(i)} className="rounded-md p-1.5 text-zinc-400 hover:bg-red-950/60 hover:text-red-300" aria-label="Excluir importação">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          {exact && (
            <div className="grid grid-cols-3 gap-3 border-t border-zinc-800 px-4 py-3 text-sm">
              <div><div className="text-xs text-zinc-500">FTD IA</div><div className="font-mono">{fmtInt(exact.ftd_ia)}</div></div>
              <div><div className="text-xs text-zinc-500">FTD painel</div><div className="font-mono">{fmtInt(exact.ftd_panel)}</div></div>
              <div><div className="text-xs text-zinc-500">Soma de depósitos (casa)</div><div className="font-mono">{fmtUSD(exact.deposits_sum_usd)}</div></div>
            </div>
          )}
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        {(['ia', 'house'] as Source[]).map((s) => (
          <ImportPanel
            key={`${s}-${opId}-${houseId}`}
            source={s}
            ctx={ctx}
            existing={imports.find((i) => i.source === s && i.period_id === exact?.id) ?? null}
            onSaved={refresh}
          />
        ))}
      </div>
    </>
  );
}

// ============================================================
// Painel de um arquivo (IA ou casa)
// ============================================================
function ImportPanel({ source, ctx, existing, onSaved }: { source: Source; ctx: Ctx | null; existing: ImportRow | null; onSaved: () => void }) {
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [opt, setOpt] = useState<ImportOptions>(DEFAULT_OPTIONS);
  const [mappingNote, setMappingNote] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [saving, setSaving] = useState(false);
  const [replace, setReplace] = useState(false);
  const [elsewhere, setElsewhere] = useState<Set<string>>(new Set());

  const set = <K extends keyof ImportOptions>(k: K, v: ImportOptions[K]) => setOpt((o) => ({ ...o, [k]: v }));

  async function onFile(f: File | undefined) {
    setError('');
    setOk('');
    setFile(null);
    setReplace(false);
    if (!f) return;
    try {
      const parsed = await readCsvFile(f);
      let next = { ...DEFAULT_OPTIONS(), columns: suggestColumns(parsed.headers) };
      let note = 'Colunas sugeridas pelo nome — confira antes de salvar.';
      if (ctx) {
        const saved = await fetchSavedMapping(ctx.houseId, source);
        if (saved && Object.values(saved.columns).every((c) => !c || parsed.headers.includes(c))) {
          next = { ...DEFAULT_OPTIONS(), ...saved, rates: saved.rates ?? {} };
          note = 'Mapeamento da última importação desta casa reaplicado.';
        }
      }
      setOpt(next);
      setMappingNote(note);
      setFile(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.');
    }
  }

  // jogadores já importados em outros períodos (mesma operação + casa + fonte)
  useEffect(() => {
    if (!ctx || !file) return;
    fetchPlayersInOtherPeriods(ctx.operation.id, ctx.houseId, source, ctx.period?.id)
      .then(setElsewhere)
      .catch(() => setElsewhere(new Set()));
  }, [ctx?.operation.id, ctx?.houseId, ctx?.period?.id, file, source]);

  const result = useMemo(
    () => (file && opt.columns.id ? normalize(file, opt, ctx ? { start: ctx.start, end: ctx.end } : undefined) : null),
    [file, opt, ctx?.start, ctx?.end],
  );
  const repeated = useMemo(() => (result ? result.records.filter((r) => elsewhere.has(r.player_id)).length : 0), [result, elsewhere]);

  async function save() {
    if (!ctx || !file || !result) return;
    setError('');
    setOk('');
    setSaving(true);
    try {
      await saveImport({
        operationId: ctx.operation.id,
        houseId: ctx.houseId,
        start: ctx.start,
        end: ctx.end,
        source,
        fileName: file.name,
        fileHash: file.hash,
        raw: file.text,
        options: opt,
        rowCount: file.rows.length,
        records: result.records,
        replace: !!existing && replace,
      });
      setOk(`Importação salva: ${fmtInt(result.stats.players)} jogadores.`);
      setFile(null);
      onSaved();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(code === '23P01' ? 'Já existe um período sobreposto para esta operação e casa.' : friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  const st = result?.stats;
  const blockers: string[] = [];
  if (!ctx) blockers.push('Selecione operação, casa e um período válido.');
  if (file && !opt.columns.id) blockers.push('Escolha a coluna do ID do jogador.');
  if (result && result.records.length === 0) blockers.push('Nenhum jogador com ID encontrado.');
  if (existing && !replace) blockers.push('Marque a opção de substituir a importação existente.');

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">{source === 'ia' ? 'Arquivo 1 · CSV da IA / Revwin' : 'Arquivo 2 · CSV da casa de apostas'}</h2>
          {existing && <p className="mt-0.5 text-xs text-amber-300">Já importado: {existing.file_name}</p>}
        </div>
        <label className={cx('inline-flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800', !ctx && 'pointer-events-none opacity-50')}>
          <Upload className="h-4 w-4" /> {file ? 'Trocar arquivo' : 'Escolher CSV'}
          <input
            type="file"
            accept=".csv,text/csv,.txt"
            className="hidden"
            aria-label={`Arquivo ${SOURCE_LABEL[source]}`}
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {ok && <div className="mb-3"><Alert kind="success">{ok}</Alert></div>}
      {!file && !ok && <p className="text-sm text-zinc-500">{ctx ? 'Nenhum arquivo selecionado.' : 'Escolha operação, casa e período acima.'}</p>}

      {file && (
        <div className="space-y-5">
          <div className="text-xs text-zinc-500">
            {file.name} · {fmtInt(file.rows.length)} linhas · {file.headers.length} colunas · separador “{file.delimiter === '\t' ? 'tab' : file.delimiter}”
          </div>

          {/* Mapeamento */}
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-medium text-zinc-300">Colunas</h3>
              <span className="text-xs text-zinc-500">{mappingNote}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {FIELDS.map((f) => (
                <Field key={f.key} label={f.label + (f.required ? ' *' : '')}>
                  <Select
                    aria-label={`Coluna ${f.label}`}
                    value={opt.columns[f.key] ?? ''}
                    onChange={(e) => set('columns', { ...opt.columns, [f.key]: e.target.value || undefined })}
                  >
                    <option value="">{f.required ? 'Selecione…' : 'Não existe'}</option>
                    {file.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
          </div>

          {/* Opções */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="O valor de depósito é">
              <Select aria-label="Tipo do depósito" value={opt.depositKind} onChange={(e) => set('depositKind', e.target.value as ImportOptions['depositKind'])}>
                <option value="first">Primeiro depósito</option>
                <option value="total">Total acumulado</option>
              </Select>
            </Field>
            <Field label="Separador decimal" hint={st && opt.decimal === 'auto' ? `Detectado: “${st.detectedDecimal}”` : undefined}>
              <Select aria-label="Separador decimal" value={opt.decimal} onChange={(e) => set('decimal', e.target.value as ImportOptions['decimal'])}>
                <option value="auto">Automático</option>
                <option value=",">Vírgula (10,50)</option>
                <option value=".">Ponto (10.50)</option>
              </Select>
            </Field>
            <Field label="Formato da data" hint={st && opt.dateFormat === 'auto' && opt.columns.date ? `Detectado: ${{ dmy: 'dia/mês', mdy: 'mês/dia', ymd: 'ano-mês-dia' }[st.detectedDateFormat]}` : undefined}>
              <Select aria-label="Formato da data" value={opt.dateFormat} onChange={(e) => set('dateFormat', e.target.value as ImportOptions['dateFormat'])}>
                <option value="auto">Automático</option>
                <option value="dmy">dd/mm/aaaa</option>
                <option value="mdy">mm/dd/aaaa</option>
                <option value="ymd">aaaa-mm-dd</option>
              </Select>
            </Field>
            {!opt.columns.currency && (
              <Field label="Moeda do arquivo">
                <Input aria-label="Moeda do arquivo" value={opt.fileCurrency} onChange={(e) => set('fileCurrency', e.target.value.toUpperCase())} placeholder="USD" />
              </Field>
            )}
          </div>

          {/* Taxas de conversão */}
          {st && st.currencies.some((c) => c !== 'USD') && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-zinc-300">Conversão para USD</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                {st.currencies.filter((c) => c !== 'USD').map((c) => {
                  const r = parseRate(opt.rates[c]);
                  return (
                    <Field key={c} label={`Quantos ${c} valem US$ 1`} hint={r ? `US$ 1 = ${r.toLocaleString('pt-BR')} ${c}` : 'Sem taxa: valores ficam sem conversão'}>
                      <Input aria-label={`Taxa ${c}`} inputMode="decimal" value={opt.rates[c] ?? ''} onChange={(e) => set('rates', { ...opt.rates, [c]: e.target.value })} />
                    </Field>
                  );
                })}
              </div>
            </div>
          )}

          {/* Resumo */}
          {st && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['Jogadores', st.players],
                  ['FTDs (depósito > 0)', st.ftd],
                  ['Sem valor de depósito', st.noDeposit],
                  ['Linhas sem ID', st.rowsWithoutId],
                ].map(([l, v]) => (
                  <div key={l as string} className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
                    <div className="text-[11px] text-zinc-500">{l}</div>
                    <div className="font-mono text-lg tabular-nums">{fmtInt(v as number)}</div>
                  </div>
                ))}
              </div>

              <Warnings
                items={[
                  st.multiRowPlayers > 0 &&
                    `${fmtInt(st.multiRowPlayers)} jogador(es) aparecem em mais de uma linha — foram unidos em 1 registro (${opt.depositKind === 'first' ? 'depósito da data mais antiga' : 'soma dos depósitos'}, apostas somadas, quantidade de depósitos guardada).`,
                  st.badNumberCount > 0 && `${fmtInt(st.badNumberCount)} valor(es) numérico(s) ilegíveis ficaram vazios. Ex.: ${st.badNumbers.map((x) => `“${x}”`).join(', ')}`,
                  st.badDateCount > 0 && `${fmtInt(st.badDateCount)} data(s) ilegíveis ficaram vazias. Ex.: ${st.badDates.map((x) => `“${x}”`).join(', ')}`,
                  st.outOfPeriod > 0 && `${fmtInt(st.outOfPeriod)} jogador(es) com data fora do período escolhido.`,
                  st.missingRates.length > 0 && `Sem taxa para ${st.missingRates.join(', ')}: esses valores serão salvos na moeda original, sem conversão para USD.`,
                  st.mixedCurrencyPlayers > 0 && `${fmtInt(st.mixedCurrencyPlayers)} jogador(es) com moedas diferentes entre linhas — ficam sem conversão.`,
                  repeated > 0 && `${fmtInt(repeated)} ID(s) já existem em outro período desta operação e casa. Confira se o arquivo não repete jogadores de outra semana.`,
                  !opt.columns.deposit && 'Sem coluna de depósito: nenhum FTD será contado neste arquivo.',
                ]}
              />

              {/* Prévia */}
              <div>
                <h3 className="mb-2 text-sm font-medium text-zinc-300">Prévia ({Math.min(15, result!.records.length)} de {fmtInt(result!.records.length)})</h3>
                <div className="overflow-x-auto rounded-lg border border-zinc-800">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-950 text-left text-zinc-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">ID</th>
                        <th className="px-3 py-2 text-right font-medium">Depósito</th>
                        <th className="px-3 py-2 text-right font-medium">Em USD</th>
                        <th className="px-3 py-2 text-right font-medium">Nº dep.</th>
                        <th className="px-3 py-2 text-right font-medium">Apostas</th>
                        <th className="px-3 py-2 font-medium">Data</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/70">
                      {result!.records.slice(0, 15).map((r) => (
                        <tr key={r.player_id} className={elsewhere.has(r.player_id) ? 'bg-amber-500/5' : undefined}>
                          <td className="px-3 py-1.5 font-mono">{r.player_id}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{r.deposit_amount == null ? '—' : `${r.deposit_amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ${r.deposit_currency ?? ''}`}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{fmtUSD(r.deposit_usd)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{r.deposit_count}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{r.bets_amount == null ? '—' : r.bets_amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                          <td className="px-3 py-1.5">{r.event_date ? fmtDate(r.event_date) : '—'}</td>
                          <td className="px-3 py-1.5">{r.status ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {existing && (
            <label className="flex items-start gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 p-3 text-sm text-amber-200">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="mt-0.5" />
              Substituir a importação existente (“{existing.file_name}”). Os registros dela serão apagados e trocados por este arquivo.
            </label>
          )}

          {blockers.length > 0 && <p className="text-xs text-zinc-500">{blockers[0]}</p>}
          <div className="flex justify-end">
            <Button onClick={save} loading={saving} disabled={blockers.length > 0 || !result}>
              Salvar importação
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Warnings({ items }: { items: (string | false)[] }) {
  const list = items.filter(Boolean) as string[];
  if (!list.length)
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-300">
        <CheckCircle2 className="h-4 w-4" /> Nenhum problema encontrado na leitura.
      </div>
    );
  return (
    <ul className="space-y-1.5">
      {list.map((w) => (
        <li key={w} className="flex gap-2 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" /> <span>{w}</span>
        </li>
      ))}
    </ul>
  );
}
