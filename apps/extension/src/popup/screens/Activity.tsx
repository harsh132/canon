import type { Activity, CoreState } from '../../shared/protocol';
import type { Tab } from '../App';
import { Header, etherscan } from '../ui';

const when = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** One activity entry, linked to its transaction. Home and the full list share it; `full` adds a second line (status, time) that more lines can follow. */
export const ActivityRow = ({ a, last, full }: { a: Activity; last: boolean; full?: boolean }) => (
  <a
    href={a.hash ? etherscan(a.hash, a.chainId) : undefined}
    target="_blank"
    rel="noreferrer"
    className={`block py-2.5 text-[13px] ${last ? '' : 'rule-dash'}`}
  >
    <div className="flex items-baseline justify-between gap-3">
      <span className="truncate">{a.label}</span>
      <span className={`flex-none font-mono text-xs tnum ${a.status === 'pending' ? 'text-warn' : a.status === 'failed' ? 'text-danger' : 'text-second'}`}>
        {a.status === 'pending' ? 'pending' : a.status === 'failed' ? 'failed' : (a.amount ?? (a.hash ? `${a.hash.slice(0, 8)}…` : ''))}
      </span>
    </div>
    {full && (
      <div className="pt-1 font-mono text-[11px] text-muted">
        {a.status} · {when(a.at)}
      </div>
    )}
  </a>
);

/** Everything the book keeps (the last 50), newest first. */
export const ActivityList = ({ s, go }: { s: CoreState; go: (t: Tab) => void }) => (
  <div>
    <Header title="Activity" onBack={() => go('home')} />
    <div className="px-[18px]">
      {s.activity.length === 0 && <p className="py-3 font-mono text-xs text-muted">Nothing yet</p>}
      {s.activity.map((a, i, list) => (
        <ActivityRow key={a.id} a={a} last={i === list.length - 1} full />
      ))}
    </div>
  </div>
);
