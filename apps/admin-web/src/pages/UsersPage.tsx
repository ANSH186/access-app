import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import { errMsg, supabase } from '../lib/supabase';
import { Dialog, ErrorNote, PageHeader } from '../components/ui';
import { ALL_ROLES, type Profile, type RoleAssignment, type RoleName } from '../types';

export default function UsersPage() {
  const { institutionId, userId } = useAuth();
  const [pickUser, setPickUser] = useState('');
  const [pickRole, setPickRole] = useState<RoleName>('responder');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ user: Profile; role: RoleName } | null>(null);
  const [search, setSearch] = useState('');

  const res = useLoad(async () => {
    const [p, r] = await Promise.all([
      supabase.from('profiles').select('*').eq('institution_id', institutionId!).order('display_name').limit(1000),
      supabase.from('role_assignments').select('*').eq('institution_id', institutionId!),
    ]);
    if (p.error) throw p.error;
    if (r.error) throw r.error;
    return { profiles: (p.data ?? []) as Profile[], roles: (r.data ?? []) as RoleAssignment[] };
  }, [institutionId]);

  const profiles = res.data?.profiles ?? [];
  const rolesOf = (id: string) => (res.data?.roles ?? []).filter((r) => r.user_id === id).map((r) => r.role);
  const shown = profiles.filter((p) => (p.display_name ?? '').toLowerCase().includes(search.toLowerCase()) || p.id.startsWith(search.toLowerCase()));

  async function add() {
    if (!pickUser || !institutionId) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('role_assignments').insert({ user_id: pickUser, institution_id: institutionId, role: pickRole });
    if (err) setError(err.code === '23505' ? 'That person already has this role.' : errMsg(err));
    else await res.reload();
    setBusy(false);
  }

  async function remove() {
    if (!confirm || !institutionId) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('role_assignments').delete()
      .eq('user_id', confirm.user.id).eq('institution_id', institutionId).eq('role', confirm.role);
    if (err) setError(errMsg(err));
    else await res.reload();
    setConfirm(null);
    setBusy(false);
  }

  return (
    <div>
      <PageHeader title="Users & Roles" sub="Roles control what each person can see and do. People with no role are ordinary app users." />
      <ErrorNote message={error ?? res.error} />

      <div className="tile mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1"><label className="label" htmlFor="u-user">Person</label>
          <select id="u-user" className="field" value={pickUser} onChange={(e) => setPickUser(e.target.value)}>
            <option value="">Choose a person&hellip;</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name || 'No name'} ({p.id.slice(0, 8)})</option>)}
          </select></div>
        <div><label className="label" htmlFor="u-role">Role</label>
          <select id="u-role" className="field" value={pickRole} onChange={(e) => setPickRole(e.target.value as RoleName)}>
            {ALL_ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
          </select></div>
        <button className="btn-primary" disabled={!pickUser || busy} onClick={() => void add()}><Plus size={16} aria-hidden="true" /> Add role</button>
      </div>

      <div className="mb-3 max-w-xs"><label className="label" htmlFor="u-search">Search by name</label>
        <input id="u-search" className="field" value={search} onChange={(e) => setSearch(e.target.value)} /></div>

      <div className="overflow-x-auto rounded-2xl border border-line/70 bg-surface">
        <table className="w-full min-w-[560px]">
          <caption className="sr-only">People in this institution and their roles</caption>
          <thead><tr className="border-b border-line/70"><th className="th" scope="col">Name</th><th className="th" scope="col">Phone</th><th className="th" scope="col">Roles</th></tr></thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className="border-b border-line/40 last:border-0">
                <td className="td"><span className="font-semibold">{p.display_name || 'No name'}</span>{p.id === userId && <span className="ml-2 text-xs text-muted">(you)</span>}
                  <span className="block text-xs text-muted">{p.id}</span></td>
                <td className="td">{p.phone || '-'}</td>
                <td className="td">
                  {rolesOf(p.id).length === 0 && <span className="text-muted">No role (app user)</span>}
                  <ul className="flex flex-wrap gap-2">
                    {rolesOf(p.id).map((r) => {
                      const self = p.id === userId && r === 'admin';
                      return (
                        <li key={r} className="chip border-accent/50 bg-accent/10 text-accent-strong">
                          {r.replace('_', ' ')}
                          <button
                            className="-mr-1 rounded-full p-0.5 hover:bg-white/10 disabled:opacity-40"
                            disabled={self}
                            title={self ? 'You cannot remove your own admin role' : undefined}
                            aria-label={`Remove ${r.replace('_', ' ')} role from ${p.display_name || 'this person'}`}
                            onClick={() => setConfirm({ user: p, role: r })}
                          ><X size={12} aria-hidden="true" /></button>
                        </li>
                      );
                    })}
                  </ul>
                </td>
              </tr>
            ))}
            {shown.length === 0 && !res.loading && <tr><td className="td text-muted" colSpan={3}>No people found.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">Email addresses are not shown: the dashboard can only read profiles, not the sign-in table.</p>

      {confirm && (
        <Dialog title="Remove role?" onClose={() => setConfirm(null)}>
          <p className="text-sm">Remove the <b>{confirm.role.replace('_', ' ')}</b> role from <b>{confirm.user.display_name || 'this person'}</b>?</p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-soft" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn-danger" disabled={busy} onClick={() => void remove()}>Remove role</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
