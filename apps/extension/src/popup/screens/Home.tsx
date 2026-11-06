import type { CoreState } from '../../shared/protocol';
import { amount, short } from '../../shared/format';
import type { Tab } from '../App';
import { call } from '../client';
import { Button, Card, Header, Slug, etherscan } from '../ui';

const ago = (t?: number) => {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? 'now' : m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
};

export const Home = ({ s, go }: { s: CoreState; go: (t: Tab) => void }) => {
  const [weth, ...others] = s.privateBalances;
  const main = s.accounts.find((a) => a.index === 0);
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
              ? { text: `Synced ${ago(s.sync.at)}`, cls: 'text-accent' }
              : { text: 'Sync', cls: 'text-accent' };

  return (
    <div>
      <Header
        title="Pangolin"
        right={
          <Button variant="link" className="text-muted" onClick={() => void call('vault.lock', null)}>
            Lock
          </Button>
        }
      />
      <div className="mx-[18px] flex items-baseline justify-between rule-dash pt-1.5 pb-2.5">
        <Slug>Private · Sepolia{process.env.PANGOLIN_FORK === '1' ? ' fork' : ''}</Slug>
        <button
          title={s.sync.error ?? s.engine.error}
          onClick={() => void call('railgun.sync', null)}
          disabled={s.sync.status === 'syncing' || s.engine.status !== 'ready'}
          className={`font-mono text-[11px] ${sync.cls}`}
        >
          {sync.text}
        </button>
      </div>

      <Card edge className="mx-[18px] mt-4 px-[18px] pt-[18px]">
        <Slug>Private balance</Slug>
        <div className="mt-2.5 flex items-baseline gap-2 font-mono tnum">
          <span className="text-[38px] leading-none font-bold tracking-tight">{amount(weth?.spendable ?? 0n)}</span>
          <span className="text-sm text-second">WETH</span>
        </div>
        {(weth?.pending ?? 0n) > 0n && (
          <div className="mt-3 flex items-baseline justify-between border-t border-dashed border-rule pt-2.5 text-[13px]">
            <Slug>Pending</Slug>
            <span className="font-mono tnum text-warn">{amount(weth!.pending)} WETH</span>
          </div>
        )}
        {others.map((t) => (
          <div key={t.token} className="flex items-baseline justify-between pt-2 text-[13px]">
            <Slug>{t.symbol}</Slug>
            <span className="font-mono tnum">
              {amount(t.spendable, t.decimals, 2)}
              {t.pending > 0n && <span className="text-warn"> · {amount(t.pending, t.decimals, 2)} pending</span>}
            </span>
          </div>
        ))}
        <div className="flex items-baseline justify-between pt-2 text-[13px]">
          <Slug>Public</Slug>
          <button className="font-mono tnum text-second" onClick={() => void call('accounts.refresh', null)}>
            {main?.balance == null ? 'Check' : `${amount(main.balance)} ETH`}
          </button>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2 px-[18px] pt-[18px]">
        <Button onClick={() => go('send')}>Send</Button>
        <Button variant="ghost" onClick={() => go('receive')}>Receive</Button>
      </div>

      <div className="px-[18px] pt-5">
        <Slug>Recent</Slug>
        {s.activity.length === 0 && <p className="py-3 font-mono text-xs text-muted">Nothing yet</p>}
        {s.activity.slice(0, 4).map((a, i, list) => (
          <a
            key={a.id}
            href={a.hash ? etherscan(a.hash) : undefined}
            target="_blank"
            rel="noreferrer"
            className={`flex items-baseline justify-between py-2.5 text-[13px] ${i < list.length - 1 ? 'rule-dash' : ''}`}
          >
            <span className="truncate">{a.label}</span>
            <span className={`font-mono text-xs tnum ${a.status === 'pending' ? 'text-warn' : a.status === 'failed' ? 'text-danger' : 'text-second'}`}>
              {a.status === 'pending' ? 'pending' : a.status === 'failed' ? 'failed' : (a.amount ?? short(a.hash ?? '', 6, 0))}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
};
