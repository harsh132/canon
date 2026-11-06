import { useState } from 'react';
import { uiKind, useCore } from './client';
import { Backup, Onboard, Ready, type BackupView } from './screens/Onboard';
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
import { Phrase, Reset } from './screens/Phrase';
import { AppHeader, Footer, SepoliaOnly } from './frame';

export type Tab = 'home' | 'send' | 'receive' | 'apps' | 'accounts' | 'privacy' | 'name' | 'swap' | 'phrase' | 'reset';

export const App = () => {
  const s = useCore();
  const [tab, setTab] = useState<Tab>('home');
  // Held here, not in Onboard: the vault flips to unlocked before the phrase is acknowledged.
  const [backup, setBackup] = useState<BackupView | null>(null);
  // Side panel: a waiting request shows as a bar until the user chooses to review it.
  const [reviewing, setReviewing] = useState(false);

  if (!s || s.vault === 'unknown') return <div className="grid h-[var(--app-h)] place-items-center"><span className="slug">Starting</span></div>;
  // Locking (or erasing) ends the visit: the next unlock starts at Home.
  if (s.vault !== 'unlocked' && tab !== 'home') setTab('home');
  if (backup) return <Backup {...backup} onDone={() => setBackup(null)} />;
  if (s.vault === 'none') return <Onboard onBackup={setBackup} />;
  // Locked: always the unlock screen first; it names any waiting request.
  if (s.vault === 'locked') return <Unlock s={s} />;
  // The onboarding tab stops here; the wallet lives in the toolbar.
  if (uiKind === 'tab') return <Ready />;
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
      <AppHeader s={s} tab={tab} go={go} />
      <div className="flex-1">
        {tab === 'home' && <Home s={s} go={go} />}
        {tab === 'send' && (s.privateNet === 'sepolia' ? <Send s={s} go={go} /> : <SepoliaOnly />)}
        {tab === 'receive' && <Receive s={s} go={go} />}
        {tab === 'apps' && <Apps s={s} />}
        {tab === 'accounts' && <Accounts s={s} go={go} />}
        {tab === 'privacy' && <Privacy s={s} go={go} />}
        {tab === 'name' && <Name s={s} go={go} />}
        {tab === 'swap' && (s.privateNet === 'sepolia' ? <Swap s={s} go={go} /> : <SepoliaOnly />)}
        {tab === 'phrase' && <Phrase s={s} go={go} />}
        {tab === 'reset' && <Reset go={go} />}
      </div>
      <Footer s={s} go={go} />
    </div>
  );
};
