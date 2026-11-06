import { useState } from 'react';
import { uiKind, useCore } from './client';
import { Backup, Onboard } from './screens/Onboard';
import { Unlock } from './screens/Unlock';
import { Home } from './screens/Home';
import { Send } from './screens/Send';
import { Receive } from './screens/Receive';
import { Apps } from './screens/Apps';
import { Accounts } from './screens/Accounts';
import { Privacy } from './screens/Privacy';
import { Name } from './screens/Name';
import { Swap } from './screens/Swap';
import { ConnectPrompt, RequestPrompt } from './screens/Prompts';

export type Tab = 'home' | 'send' | 'receive' | 'apps' | 'accounts' | 'privacy' | 'name' | 'swap';

const NAV: { tab: Tab; label: string }[] = [
  { tab: 'home', label: 'Home' },
  { tab: 'send', label: 'Send' },
  { tab: 'apps', label: 'Apps' },
  { tab: 'accounts', label: 'Addresses' },
];

export const App = () => {
  const s = useCore();
  const [tab, setTab] = useState<Tab>('home');
  // Held here, not in Onboard: the vault flips to unlocked before the phrase is acknowledged.
  const [backup, setBackup] = useState<string | null>(null);
  // Side panel: a waiting request shows as a bar until the user chooses to review it.
  const [reviewing, setReviewing] = useState(false);

  if (!s || s.vault === 'unknown') return <div className="grid h-[var(--app-h)] place-items-center"><span className="slug">Starting</span></div>;
  if (backup) return <Backup phrase={backup} onDone={() => setBackup(null)} />;
  if (s.vault === 'none') return <Onboard onBackup={setBackup} />;
  // Locked: always the unlock screen first; it names any waiting request.
  if (s.vault === 'locked') return <Unlock s={s} />;
  const pending = s.wc.proposal ?? s.wc.request;
  if (!pending && reviewing) setReviewing(false);
  const showPrompt = uiKind !== 'panel' || reviewing;
  if (s.wc.proposal && showPrompt) return <ConnectPrompt s={s} />;
  if (s.wc.request && showPrompt) return <RequestPrompt s={s} />;

  const go = (t: Tab) => setTab(t);
  return (
    <div className="flex min-h-[var(--app-h)] flex-col">
      {pending && (
        <button
          onClick={() => setReviewing(true)}
          className="flex items-center justify-between gap-3 bg-accent px-[18px] py-2.5 text-left font-mono text-[11px] font-bold tracking-[0.1em] text-on-accent uppercase"
        >
          <span className="truncate">{s.wc.proposal ? `${s.wc.proposal.origin ?? s.wc.proposal.name} wants to connect` : `${s.wc.request!.origin ?? s.wc.request!.dapp}: ${s.wc.request!.title}`}</span>
          <span>Review</span>
        </button>
      )}
      <div className="flex-1">
        {tab === 'home' && <Home s={s} go={go} />}
        {tab === 'send' && <Send s={s} go={go} />}
        {tab === 'receive' && <Receive s={s} go={go} />}
        {tab === 'apps' && <Apps s={s} />}
        {tab === 'accounts' && <Accounts s={s} />}
        {tab === 'privacy' && <Privacy s={s} go={go} />}
        {tab === 'name' && <Name s={s} go={go} />}
        {tab === 'swap' && <Swap s={s} go={go} />}
      </div>
      <nav aria-label="Main" className="sticky bottom-0 flex justify-between border-t border-rule bg-page px-[18px] pt-3 pb-3.5 font-mono text-[10px] tracking-[0.18em] uppercase">
        {NAV.map((n) => (
          <button
            key={n.tab}
            onClick={() => go(n.tab)}
            aria-current={tab === n.tab ? 'page' : undefined}
            className={tab === n.tab ? 'border-b-2 border-accent pb-0.5 text-accent' : 'pb-0.5 text-muted hover:text-ink'}
          >
            {n.label}
          </button>
        ))}
      </nav>
    </div>
  );
};
