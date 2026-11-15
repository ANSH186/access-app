import { useState, type FormEvent } from 'react';
import { LogIn } from 'lucide-react';
import { errMsg, supabase } from '../lib/supabase';
import { ErrorNote } from '../components/ui';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) setError(err.message === 'Invalid login credentials' ? 'That email and password do not match.' : errMsg(err));
    setBusy(false);
  }

  return (
    <main className="grid min-h-full place-items-center p-6">
      <form onSubmit={submit} className="tile w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AccessAble Admin</h1>
          <p className="mt-1 text-sm text-muted">Sign in with your campus staff account.</p>
        </div>
        <div>
          <label htmlFor="email" className="label">Email</label>
          <input id="email" type="email" autoComplete="username" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="password" className="label">Password</label>
          <input id="password" type="password" autoComplete="current-password" required className="field" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <ErrorNote message={error} />
        <button className="btn-primary w-full" disabled={busy}>
          <LogIn size={16} aria-hidden="true" /> {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="text-xs text-muted">AccessAble is not an emergency service. For life-threatening emergencies call 112.</p>
      </form>
    </main>
  );
}
