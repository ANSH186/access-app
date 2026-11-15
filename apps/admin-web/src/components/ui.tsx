import { useEffect, useRef, type ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { fmtDuration } from '../lib/format';
import { useNow } from '../hooks/useNow';
import type { AlertStatus, EdgeStatus, ReportStatus } from '../types';

export function TestBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`chip border-warn/60 bg-warn/15 text-warn ${className}`} title="Test alert - not a real emergency">
      TEST
    </span>
  );
}

const ALERT_STYLE: Record<AlertStatus, { text: string; cls: string; mark: string }> = {
  triggered: { text: 'Unacknowledged', cls: 'border-red-400 bg-red-600 text-white', mark: '!' },
  acknowledged: { text: 'Acknowledged', cls: 'border-warn/70 bg-warn/15 text-warn', mark: '✓' },
  responding: { text: 'Responding', cls: 'border-accent/70 bg-accent/15 text-accent-strong', mark: '→' },
  unable_to_contact: { text: 'Unable to contact', cls: 'border-orange-400/70 bg-orange-500/15 text-orange-300', mark: '?' },
  resolved: { text: 'Resolved', cls: 'border-ok/60 bg-ok/10 text-ok', mark: '✓' },
  cancelled: { text: 'Cancelled by user', cls: 'border-slate-500 bg-slate-500/15 text-slate-300', mark: '✕' },
};
export function AlertStatusChip({ status }: { status: AlertStatus }) {
  const s = ALERT_STYLE[status];
  return (
    <span className={`chip ${s.cls}`}>
      <span aria-hidden="true">{s.mark}</span>
      {s.text}
    </span>
  );
}

const REPORT_STYLE: Record<ReportStatus, string> = {
  submitted: 'border-warn/70 bg-warn/15 text-warn',
  under_review: 'border-accent/70 bg-accent/15 text-accent-strong',
  verified: 'border-ok/60 bg-ok/10 text-ok',
  assigned: 'border-violet-400/70 bg-violet-500/15 text-violet-300',
  resolved: 'border-ok/60 bg-ok/10 text-ok',
  closed: 'border-slate-500 bg-slate-500/15 text-slate-300',
  rejected: 'border-red-400/70 bg-red-500/15 text-red-300',
  reopened: 'border-orange-400/70 bg-orange-500/15 text-orange-300',
};
export function ReportStatusChip({ status }: { status: ReportStatus }) {
  return <span className={`chip ${REPORT_STYLE[status]}`}>{status.replace(/_/g, ' ')}</span>;
}

export function EdgeStatusChip({ status }: { status: EdgeStatus }) {
  return status === 'blocked' ? (
    <span className="chip border-red-400/70 bg-red-500/15 text-red-300">Blocked</span>
  ) : (
    <span className="chip border-ok/60 bg-ok/10 text-ok">Open</span>
  );
}

/** Self-ticking age, so only this text re-renders each second. */
export function Age({ since, until }: { since: string; until?: string | null }) {
  const now = useNow(1000);
  const end = until ? new Date(until).getTime() : now;
  return <span className="tabular-nums">{fmtDuration(end - new Date(since).getTime())}</span>;
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-400/50 bg-red-500/10 px-3 py-2 text-sm text-red-200">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

export function PageHeader({ title, children, sub }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

/** Frosted-glass side panel. Escape closes it; focus moves into it on open. */
export function SidePanel({
  label, onClose, children, width = 'w-full sm:w-[460px]',
}: { label: string; onClose: () => void; children: ReactNode; width?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <aside
      ref={ref}
      tabIndex={-1}
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      className={`glass slide-in fixed bottom-0 right-0 top-14 z-30 flex flex-col overflow-y-auto outline-none ${width}`}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line/60 bg-surface/70 px-5 py-3 backdrop-blur">
        <h2 className="text-base font-bold">{label}</h2>
        <button className="btn-ghost !px-2" onClick={onClose} aria-label="Close panel">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="flex-1 space-y-5 p-5">{children}</div>
    </aside>
  );
}

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onMouseDown={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        className="glass-dialog w-full max-w-lg rounded-2xl p-6 outline-none"
      >
        <h2 className="mb-4 text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Disclaimer() {
  return (
    <p className="text-xs text-muted">
      AccessAble is not an emergency service. For life-threatening emergencies call 112.
    </p>
  );
}

export function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{k}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}
