import { NavLink, Outlet } from 'react-router-dom';
import {
  FileWarning, LayoutDashboard, LogOut, Map as MapIcon, Settings, Siren, Users, Volume2, VolumeX,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useEmergency } from '../hooks/useEmergency';
import { useApiHealth } from '../hooks/useApiHealth';
import SosBanner from './SosBanner';
import type { RoleName } from '../types';

interface NavItem { to: string; label: string; icon: typeof Siren; roles?: RoleName[] }
export const NAV: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/emergency', label: 'Emergency', icon: Siren, roles: ['admin', 'responder'] },
  { to: '/reports', label: 'Reports', icon: FileWarning, roles: ['admin', 'maintenance', 'map_editor'] },
  { to: '/map', label: 'Map', icon: MapIcon },
  { to: '/users', label: 'Users & Roles', icon: Users, roles: ['admin'] },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function ApiDot() {
  const { status, latencyMs } = useApiHealth();
  const map = {
    unconfigured: ['bg-slate-500', 'API not configured'],
    checking: ['bg-slate-400', 'API checking...'],
    ok: ['bg-ok', `API online${latencyMs != null ? ` (${latencyMs} ms)` : ''}`],
    waking: ['bg-warn', 'API waking up...'],
    down: ['bg-red-400', 'API unreachable'],
  } as const;
  const [c, t] = map[status];
  return (
    <span className="flex items-center gap-2 text-xs text-muted" role="status">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${c}`} aria-hidden="true" />
      {t}
    </span>
  );
}

function LiveStatus() {
  const { enabled, connection } = useEmergency();
  if (!enabled) return null;
  const live = connection === 'live';
  return (
    <span className="flex items-center gap-2 text-xs text-muted" role="status">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${live ? 'bg-ok' : 'bg-warn'}`} aria-hidden="true" />
      {live ? 'Live' : 'Reconnecting…'}
    </span>
  );
}

export default function Layout() {
  const { institution, email, roles, signOut, hasRole } = useAuth();
  const em = useEmergency();
  return (
    <div className="flex h-full flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-[#04202F]">
        Skip to content
      </a>
      <header className="z-40 flex h-14 shrink-0 items-center gap-4 border-b border-line/70 bg-surface/90 px-4 backdrop-blur">
        <div className="flex items-center gap-2 font-bold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-sm text-[#04202F]" aria-hidden="true">A</span>
          AccessAble <span className="font-normal text-muted">Admin</span>
        </div>
        {institution?.test_mode_only && (
          <span className="chip border-warn bg-warn/20 text-warn" title="All alerts are treated as tests">TEST MODE</span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1">
          <LiveStatus />
          <ApiDot />
          {em.enabled && (
            <>
              {!em.audioReady && (
                <button className="btn-soft !min-h-0 !py-1 !text-xs" onClick={() => void em.enableSound()}>
                  <Volume2 size={14} aria-hidden="true" /> Enable sound alerts
                </button>
              )}
              <button
                className="btn-soft !min-h-0 !py-1 !text-xs"
                aria-pressed={em.muted}
                onClick={() => em.setMuted(!em.muted)}
              >
                {em.muted ? <VolumeX size={14} aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />}
                {em.muted ? 'Sound muted' : 'Sound on'}
              </button>
            </>
          )}
          <span className="hidden text-xs text-muted md:inline" title={roles.join(', ')}>{email}</span>
          <button className="btn-ghost !min-h-0 !py-1 !text-xs" onClick={() => void signOut()}>
            <LogOut size={14} aria-hidden="true" /> Sign out
          </button>
        </div>
      </header>

      <SosBanner />
      <div aria-live="assertive" role="alert" className="sr-only">{em.announcement}</div>

      <div className="flex min-h-0 flex-1">
        <nav aria-label="Main" className="w-16 shrink-0 border-r border-line/70 bg-surface/60 py-3 md:w-56">
          <ul className="space-y-1 px-2">
            {NAV.filter((n) => !n.roles || hasRole(...n.roles)).map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.to === '/'}
                  title={n.label}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                      isActive ? 'bg-accent/15 text-accent-strong shadow-[inset_3px_0_0_#38BDF8]' : 'text-muted hover:bg-white/5 hover:text-ink'
                    }`
                  }
                >
                  <n.icon size={18} aria-hidden="true" />
                  <span className="hidden md:inline">{n.label}</span>
                  <span className="sr-only md:hidden">{n.label}</span>
                  {n.to === '/emergency' && em.unacknowledged.length > 0 && (
                    <span className="ml-auto rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                      {em.unacknowledged.length}<span className="sr-only"> unacknowledged</span>
                    </span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto p-6 outline-none">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
