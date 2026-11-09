import type { CoreState } from '../../shared/protocol';
import { amount, short } from '../../shared/format';
import type { Tab } from '../App';
import { call } from '../client';
import { Button, Card, Slug, etherscan } from '../ui';
import { SiteCard } from './SiteCard';
import { Fund } from './Fund';
import { useEffect, useState } from 'react';
import { etaText } from '../../shared/eta';

export const Home = ({ s, go }: { s: CoreState; go: (t: Tab) => void }) => {
  const [funding, setFunding] = useState<{ address: string; origin: string } | null>(null);
  const [weth, ...others] = s.privateBalances;
  const main = s.accounts.find((a) => a.index === 0);
  // Re-render from the stored time; the core sends no new state for this.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!s.pendingEta) return;
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [s.pendingEta]);
  const eta = s.privateBalances.some((b) => b.pending > 0n) ? etaText(s.pendingEta, Date.now()) : null;

  if (funding) return <Fund s={s} address={funding.address} origin={funding.origin} onDone={() => setFunding(null)} />;

  return (
    <div className="pt-3">
      <SiteCard s={s} onFund={(address, origin) => setFunding({ address, origin })} />

      <Card edge className="mx-[18px] mt-4 px-[18px] pt-[18px]">
        <Slug>Private balance</Slug>
        <div className="mt-2.5 flex items-baseline gap-2 font-mono tnum">
          <span className="text-[38px] leading-none font-bold tracking-tight">{amount(weth?.spendable ?? 0n)}</span>
          <span className="text-sm text-second">ETH</span>
        </div>
        {(weth?.pending ?? 0n) > 0n && (
          <div className="mt-3 flex items-baseline justify-between border-t border-dashed border-rule pt-2.5 text-[13px]">
            <Slug>Pending</Slug>
            <span className="font-mono tnum text-warn">{amount(weth!.pending)} ETH</span>
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
        {eta && <div className="pt-2 text-right text-[12px] text-muted">{eta}</div>}
      </Card>

      {main && (
        <div className="mx-[18px] flex items-baseline justify-between rule-dash pt-3 pb-2.5 text-[13px]">
          <span className="flex items-baseline gap-2">
            <Slug>Public</Slug>
            <span className="font-mono text-[11px] text-muted">
              {main.label} · {short(main.address, 6, 4)}
            </span>
          </span>
          <button className="font-mono tnum text-second" onClick={() => void call('accounts.refresh', null)}>
            {main.balance == null ? 'Check' : `${amount(main.balance)} ETH`}
          </button>
        </div>
      )}

      <div className="px-[18px] pt-4">
        <Button variant="ghost" className="w-full" onClick={() => go('receive')}>
          Receive
        </Button>
      </div>

      <div className="px-[18px] pt-5">
        <Slug>Recent</Slug>
        {s.activity.length === 0 && <p className="py-3 font-mono text-xs text-muted">Nothing yet</p>}
        {s.activity.slice(0, 4).map((a, i, list) => (
          <a
            key={a.id}
            href={a.hash ? etherscan(a.hash, a.chainId) : undefined}
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
