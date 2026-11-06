import { useEffect, useState } from 'react';
import type { CoreState } from '../../shared/protocol';
import { amount, short } from '../../shared/format';
import { call, panelTab } from '../client';
import { AppIcon, Button, Card, Copy, Row, Slug, faviconFor } from '../ui';

type Balances = { eth: bigint; tokens: { symbol: string; decimals: number; amount: bigint }[] };

/**
 * The side panel's view of its own tab: which site is open there, which public
 * address that site sees, and what that address holds. Only in the panel.
 */
export const SiteCard = ({ s, onFund }: { s: CoreState; onFund?: (address: string, origin: string) => void }) => {
  const origin = panelTab ? s.tabs[panelTab] : undefined;
  const account = origin ? s.accounts.find((a) => a.origins.includes(origin)) : undefined;
  const connected = !!origin && (s.sites.some((x) => x.origin === origin) || !!account);
  const [bal, setBal] = useState<Balances | null>(null);

  // Read once per site, and on demand; never polled.
  const refresh = () => {
    if (!account) return;
    void call('site.balances', { address: account.address }).then(setBal, () => setBal(null));
  };
  useEffect(() => {
    setBal(null);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.address]);

  if (!panelTab || s.vault !== 'unlocked') return null;
  // No dapp in this tab: nothing to show.
  if (!origin) return null;

  return (
    <Card className="mx-[18px] px-[18px] py-3.5">
      <div className="flex items-center gap-3">
        <AppIcon name={origin} src={faviconFor(origin)} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[14px] font-bold">{origin}</div>
          <div className="truncate text-xs text-second">{connected && account ? `as ${account.label}` : 'Not connected'}</div>
        </div>
        {account && <Copy value={account.address} label={short(account.address)} />}
      </div>
      {account && (
        <div className="mt-2.5 border-t border-dashed border-rule">
          <Row label="ETH">{bal ? amount(bal.eth) : '…'}</Row>
          {bal?.tokens.filter((t) => t.amount > 0n).map((t) => (
            <Row key={t.symbol} label={t.symbol}>{amount(t.amount, t.decimals, t.decimals > 6 ? 4 : 2)}</Row>
          ))}
          <div className="flex items-center justify-between pt-2.5">
            <Button variant="link" className="text-muted" onClick={refresh}>Refresh</Button>
            {onFund && (
              <Button variant="ghost" className="px-4 py-2" onClick={() => onFund(account.address, origin)}>
                Fund
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
};
