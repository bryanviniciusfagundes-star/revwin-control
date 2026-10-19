import { useState, type FormEvent } from 'react';
import { supabase, isConfigured } from '../lib/supabase';
import { Alert, Button, Field, Input } from '../components/ui';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) setError(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message);
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-500 font-mono text-lg font-bold text-zinc-950">R</div>
          <h1 className="mt-4 text-xl font-semibold">Revwin Control</h1>
          <p className="mt-1 text-sm text-zinc-500">Acesso privado</p>
        </div>

        <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          {!isConfigured && (
            <Alert kind="info">Configure SUPABASE_URL e SUPABASE_ANON_KEY em <code className="font-mono">src/config.ts</code>.</Alert>
          )}
          <Field label="E-mail">
            <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Senha">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" loading={loading} className="w-full">
            Entrar
          </Button>
        </div>
      </form>
    </div>
  );
}
