// The frame around every unlocked screen: header (mark, network, lock, menu),
// tabs under it, and one status line at the bottom.
import { useState, type ReactNode } from 'react';
import type { CoreState } from '../shared/protocol';
import type { Tab } from './App';
import { call } from './client';
import { Mark } from './ui';

const TABS: { tab: Tab; label: string }[] = [
  { tab: 'home', label: 'Home' },
  { tab: 'send', label: 'Send' },
  { tab: 'swap', label: 'Swap' },
  { tab: 'apps', label: 'Apps' },
];

const IconButton = ({ label, onClick, children, active }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) => (
  <button
    onClick={onClick}
    title={label}
    aria-expanded={active}
    className={`grid h-8 w-8 place-items-center rounded-sm border ${active ? 'border-accent text-accent' : 'border-transparent text-second hover:text-ink'}`}
  >
    {children}
    <span className="sr-only">{label}</span>
  </button>
);

const svg = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export const AppHeader = ({ s, tab, go }: { s: CoreState; tab: Tab; go: (t: Tab) => void }) => {
  const [open, setOpen] = useState(false);
  const pick = (t: Tab) => {
    setOpen(false);
    go(t);
  };
  const items: { tab: Tab; label: string; cls?: string }[] = [
    { tab: 'name', label: s.name ?? 'Get a name' },
    { tab: 'accounts', label: 'Addresses' },
    { tab: 'privacy', label: 'Privacy' },
    { tab: 'phrase', label: 'Recovery phrase' },
    { tab: 'reset', label: 'Reset', cls: 'text-danger' },
  ];
  return (
    <header className="sticky top-0 z-20 bg-page">
      <div className="flex items-center justify-between px-[18px] pt-3.5 pb-1.5">
        <div className="flex items-center gap-2">
          <Mark />
          <span className="font-mono text-[11px] font-bold tracking-[0.18em] uppercase">Canon Wallet</span>
          <PrivateNet s={s} />
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton label="Lock" onClick={() => void call('vault.lock', null)}>
            <svg {...svg}>
              <rect x="5" y="11" width="14" height="9.5" rx="1.5" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </IconButton>
          <IconButton label="Menu" active={open} onClick={() => setOpen(!open)}>
            <svg {...svg}>
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </IconButton>
        </div>
      </div>
      <nav aria-label="Main" className="flex gap-6 border-b border-rule px-[18px] font-mono text-[10px] tracking-[0.18em] uppercase">
        {TABS.map((n) => (
          <button
            key={n.tab}
            onClick={() => pick(n.tab)}
            aria-current={tab === n.tab ? 'page' : undefined}
            className={`-mb-px border-b-2 pt-1.5 pb-2 ${tab === n.tab ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {n.label}
          </button>
        ))}
      </nav>
      {open && (
        <>
          <button aria-label="Close menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute top-12 right-[18px] z-20 w-52 rounded-sm border border-rule bg-sheet py-1 shadow-lift">
            {items.map((m) => (
              <button
                key={m.tab}
                role="menuitem"
                onClick={() => pick(m.tab)}
                className={`flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] hover:bg-page ${m.cls ?? ''}`}
              >
                {m.tab === 'name' && <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.name ? 'bg-accent' : 'bg-rule-strong'}`} />}
                {m.label}
              </button>
            ))}
          </div>
        </>
      )}
    </header>
  );
};

/** The private network badge; its menu switches RAILGUN between Sepolia and Arbitrum. */
const PrivateNet = ({ s }: { s: CoreState }) => {
  const [open, setOpen] = useState(false);
  const nets: { id: 'sepolia' | 'arbitrum'; label: string }[] = [
    { id: 'sepolia', label: 'Sepolia' },
    { id: 'arbitrum', label: 'Arbitrum' },
  ];
  const current = nets.find((n) => n.id === s.privateNet)!;
  return (
    <span className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Private network"
        className={`rounded-sm border px-1.5 py-px font-mono text-[9px] tracking-[0.14em] uppercase ${s.privateNet === 'sepolia' ? 'border-rule text-warn' : 'border-rule text-accent'}`}
      >
        {current.label}
        {process.env.CANON_FORK === '1' ? ' fork' : ''}
      </button>
      {open && (
        <>
          <button aria-label="Close" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute top-6 left-0 z-20 w-48 rounded-sm border border-rule bg-sheet py-1 shadow-lift">
            <div className="px-3.5 pt-1.5 pb-1 font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Private network · switching locks</div>
            {nets.map((n) => (
              <button
                key={n.id}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  if (n.id !== s.privateNet) void call('net.setPrivate', { net: n.id });
                }}
                className={`flex w-full items-center justify-between px-3.5 py-2 text-left text-[13px] hover:bg-page ${n.id === s.privateNet ? 'text-accent' : ''}`}
              >
                {n.label}
                {n.id === 'sepolia' && <span className="font-mono text-[9px] tracking-[0.14em] text-warn uppercase">Test</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
};

const ago = (t?: number) => {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? 'now' : m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
};

/** One line of status: where reads go and how fresh the private balance is. */
export const Footer = ({ s, go }: { s: CoreState; go: (t: Tab) => void }) => {
  const noTunnels = s.rpc.mode === 'nox' && !!s.rpc.noTunnelsAt;
  const clean = s.rpc.mode === 'nox' && s.rpc.counts.clear === 0 && s.rpc.status !== 'error' && !noTunnels;
  const sync =
    s.engine.status === 'error'
      ? { text: 'Engine error', cls: 'text-danger' }
      : s.engine.status !== 'ready'
        ? { text: 'Starting engine', cls: 'text-muted' }
        : s.sync.status === 'syncing'
          ? { text: `Syncing ${Math.round(s.sync.progress * 100)}%`, cls: 'text-warn' }
          : s.sync.status === 'error'
            ? { text: 'Sync failed · retry', cls: 'text-danger' }
            : s.sync.status === 'done'
              ? { text: `Synced ${ago(s.sync.at)}`, cls: 'text-second' }
              : { text: 'Sync', cls: 'text-accent' };
  return (
    <footer className="sticky bottom-0 z-10 flex items-center justify-between border-t border-rule bg-page px-[18px] py-2.5 font-mono text-[10px] tnum">
      <button onClick={() => go('privacy')} className={`flex items-center gap-1.5 ${clean ? 'text-second' : 'text-warn'}`}>
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${clean ? 'bg-accent' : 'bg-warn'}`} />
        {s.rpc.mode === 'nox' ? 'Nox' : 'Direct'} · {s.rpc.status === 'error' ? 'Nox down' : noTunnels ? 'no exits' : `${s.rpc.counts.clear} clear · ${s.rpc.counts.mixed} mixed`}
      </button>
      <button
        title={s.sync.error ?? s.engine.error}
        onClick={() => void call('railgun.sync', null)}
        disabled={s.sync.status === 'syncing' || s.engine.status !== 'ready'}
        className={sync.cls}
      >
        {sync.text}
      </button>
    </footer>
  );
};

/** Send and Swap while RAILGUN is on Arbitrum: view-only for now. */
export const SepoliaOnly = () => (
  <div className="flex flex-col items-center gap-3 px-[18px] pt-20 text-center">
    <span className="stamp">Sepolia only</span>
    <p className="text-[14px] text-second">Private sends and swaps run on Sepolia for now. Arbitrum is view-only.</p>
  </div>
);
