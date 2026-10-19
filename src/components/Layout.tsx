import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Briefcase, ClipboardList, FileUp, History, LayoutDashboard, LogOut, Menu, Settings, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Alert, Button, Field, Input, Modal, cx } from './ui';
import { DEFAULT_TOLERANCE, fetchTolerance, friendlyError, saveTolerance } from '../lib/data';
import { parseNum } from '../lib/format';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/operacoes', label: 'Operações', icon: Briefcase },
  { to: '/resultados', label: 'Registrar Resultados', icon: ClipboardList },
  { to: '/importar', label: 'Importar e Conferir', icon: FileUp },
  { to: '/historico', label: 'Histórico', icon: History },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <div className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-500 font-mono text-sm font-bold text-zinc-950">R</div>
      <div className="leading-tight">
        <div className="text-sm font-semibold">Revwin Control</div>
        <div className="text-[11px] text-zinc-500">Controle iGaming</div>
      </div>
    </div>
  );
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tol, setTol] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    fetchTolerance()
      .then((t) => setTol(String(t).replace('.', ',')))
      .catch((e) => setError(friendlyError(e)));
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setOk(false);
    try {
      const v = parseNum(tol, { label: 'Tolerância', min: 0 });
      setSaving(true);
      await saveTolerance(v ?? DEFAULT_TOLERANCE);
      setOk(true);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal open title="Configurações" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Tolerância de divergência (USD)" hint="Diferenças de depósito acima deste valor viram divergência. Padrão: US$ 1,00.">
          <Input aria-label="Tolerância" inputMode="decimal" value={tol} onChange={(e) => setTol(e.target.value)} />
        </Field>
        {error && <Alert>{error}</Alert>}
        {ok && <Alert kind="success">Configuração salva. Conferências já salvas mantêm a tolerância usada; salve-as de novo para recalcular.</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Fechar</Button>
          <Button type="submit" loading={saving}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const { session } = useAuth();
  const [settings, setSettings] = useState(false);
  return (
    <div className="flex h-full flex-col">
      <Brand />
      <nav className="mt-8 flex-1 space-y-1">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cx(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200',
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-zinc-800 pt-4">
        <button
          onClick={() => setSettings(true)}
          className="mb-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
        >
          <Settings className="h-4 w-4" /> Configurações
        </button>
        {settings && <SettingsModal onClose={() => setSettings(false)} />}
        <div className="truncate px-3 text-xs text-zinc-500">{session?.user.email}</div>
        <button
          onClick={() => supabase.auth.signOut()}
          className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
        >
          <LogOut className="h-4 w-4" /> Sair
        </button>
      </div>
    </div>
  );
}

export default function Layout() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const current = NAV.find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)));

  return (
    <div className="min-h-full lg:flex">
      {/* Sidebar desktop */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-zinc-800 bg-zinc-950 p-4 lg:block">
        <Nav />
      </aside>

      {/* Topo mobile */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-zinc-800 bg-zinc-950/90 px-4 py-3 backdrop-blur lg:hidden">
        <span className="text-sm font-medium">{current?.label ?? 'Revwin Control'}</span>
        <button onClick={() => setOpen(true)} className="rounded-md p-1.5 text-zinc-300 hover:bg-zinc-800" aria-label="Abrir menu">
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {/* Drawer mobile */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-zinc-800 bg-zinc-950 p-4">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-3 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800" aria-label="Fechar menu">
              <X className="h-5 w-5" />
            </button>
            <Nav onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
