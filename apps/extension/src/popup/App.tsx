import { useState } from 'react';
import { useCore } from './client';
import { Onboard } from './screens/Onboard';
import { Unlock } from './screens/Unlock';
import { Home } from './screens/Home';
import { Send } from './screens/Send';
import { Receive } from './screens/Receive';
import { Apps } from './screens/Apps';
import { Accounts } from './screens/Accounts';
import { ConnectPrompt, RequestPrompt } from './screens/Prompts';

export type Tab = 'home' | 'send' | 'receive' | 'apps' | 'accounts';

const NAV: { tab: Tab; label: string }[] = [
  { tab: 'home', label: 'Home' },
  { tab: 'send', label: 'Send' },
  { tab: 'apps', label: 'Apps' },
  { tab: 'accounts', label: 'Addresses' },
];

export const App = () => {
  const s = useCore();
  const [tab, setTab] = useState<Tab>('home');

  if (!s) return <div className="grid h-[600px] place-items-center"><span className="slug">Starting</span></div>;
  if (s.vault === 'none') return <Onboard />;
  if (s.wc.proposal) return <ConnectPrompt s={s} />;
  if (s.vault === 'locked') return <Unlock s={s} />;
  if (s.wc.request) return <RequestPrompt s={s} />;

  const go = (t: Tab) => setTab(t);
  return (
    <div className="flex min-h-[600px] flex-col">
      <div className="flex-1">
        {tab === 'home' && <Home s={s} go={go} />}
        {tab === 'send' && <Send s={s} go={go} />}
        {tab === 'receive' && <Receive s={s} go={go} />}
        {tab === 'apps' && <Apps s={s} />}
        {tab === 'accounts' && <Accounts s={s} />}
      </div>
      <nav aria-label="Main" className="flex justify-between border-t border-rule px-[18px] pt-3 pb-3.5 font-mono text-[10px] tracking-[0.18em] uppercase">
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
