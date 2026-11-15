import { useState } from 'react';
import { Activity, Bell, Volume2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useEmergency } from '../hooks/useEmergency';
import { useApiHealth } from '../hooks/useApiHealth';
import { API_URL, apiConfigured } from '../lib/api';
import { KV, PageHeader } from '../components/ui';

export default function SettingsPage() {
  const { institution, roles, hasRole } = useAuth();
  const em = useEmergency();
  const api = useApiHealth();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const showAlerts = hasRole('admin', 'responder');

  async function health() {
    setChecking(true);
    setResult('Checking… (a sleeping server can take about a minute)');
    const r = await api.check();
    setResult(r.ok ? `API is healthy. Round trip ${r.latencyMs} ms.` : `${r.error ?? 'Failed'} (after ${r.latencyMs} ms)`);
    setChecking(false);
  }

  return (
    <div>
      <PageHeader title="Settings" sub={institution?.name} />
      <div className="grid gap-4 md:grid-cols-2">
        <section className="tile" aria-label="Test mode">
          <h2 className="mb-2 text-base font-bold">Test mode</h2>
          <p className="text-sm">
            {institution?.test_mode_only
              ? 'ON. Every SOS is treated as a test, even if the app says otherwise. This is a pilot.'
              : 'OFF. SOS alerts from the app can be real.'}
          </p>
          <p className="mt-2 text-xs text-muted">Read-only here. It is set in the database (institutions.test_mode_only).</p>
          <dl className="mt-3"><KV k="Your roles">{roles.join(', ') || 'none'}</KV></dl>
        </section>

        <section className="tile" aria-label="API health">
          <h2 className="mb-2 flex items-center gap-2 text-base font-bold"><Activity size={16} aria-hidden="true" /> API health</h2>
          <p className="text-sm text-muted">{apiConfigured ? API_URL : 'VITE_API_URL is not set.'}</p>
          <button className="btn-primary mt-3" disabled={checking || !apiConfigured} onClick={() => void health()}>Check now</button>
          <p className="mt-2 text-sm" role="status">{result ?? (api.latencyMs != null ? `Last check: ${api.status === 'ok' ? 'healthy' : 'failed'}, ${api.latencyMs} ms.` : '')}</p>
          <p className="mt-1 text-xs text-muted">While this dashboard is open it pings /health every 10 minutes so the free server stays awake. Emergency alerts do not depend on this server.</p>
        </section>

        {showAlerts && (
          <section className="tile" aria-label="Alert sound and notifications">
            <h2 className="mb-2 text-base font-bold">Alert sound and notifications</h2>
            <div className="flex flex-wrap gap-2">
              <button className="btn-soft" onClick={() => void em.testSound()}><Volume2 size={16} aria-hidden="true" /> Test alert sound</button>
              <button className="btn-soft" disabled={em.notifPermission !== 'default'} onClick={() => void em.requestNotifications()}>
                <Bell size={16} aria-hidden="true" /> Enable browser notifications
              </button>
            </div>
            <ul className="mt-3 space-y-1 text-sm">
              <li>Sound: {em.audioReady ? 'unlocked' : 'locked until you click a sound button'}{em.muted ? ' (muted)' : ''}</li>
              <li>Notifications: {em.notifPermission === 'unsupported' ? 'not supported by this browser' : em.notifPermission === 'default' ? 'not asked yet' : em.notifPermission}</li>
            </ul>
          </section>
        )}

        <section className="tile" aria-label="Alert channels">
          <h2 className="mb-2 text-base font-bold">Alert channels</h2>
          <ul className="space-y-1 text-sm">
            <li><span aria-hidden="true">{'✓'} </span>In-app realtime: active (only while a dashboard tab is open)</li>
            <li><span aria-hidden="true">{'✗'} </span>SMS: not configured</li>
            <li><span aria-hidden="true">{'✗'} </span>Push: not configured</li>
          </ul>
          <p className="mt-3 text-sm">Escalation: on-screen only (SMS/phone not configured). An SOS unacknowledged for more than 2 minutes gets a louder, faster tone and an &ldquo;UNACKNOWLEDGED FOR 2+ MIN&rdquo; banner.</p>
          <p className="mt-3 text-xs text-muted">Nobody is alerted if no one has this dashboard open. Do not rely on it as the only channel.</p>
        </section>
      </div>
    </div>
  );
}
