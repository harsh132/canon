import { useState } from 'react';
import type { CoreState } from '../../shared/protocol';
import { amount, short } from '../../shared/format';
import type { Tab } from '../App';
import { call, useAction } from '../client';
import { Button, Copy, Header, Input, AppIcon, faviconFor } from '../ui';

export const Accounts = ({ s, go }: { s: CoreState; go: (t: Tab) => void }) => {
  const [label, setLabel] = useState('');
  const a = useAction();

  return (
    <div>
      <Header
        title="Addresses"
        onBack={() => go('home')}
        right={<Button variant="link" busy={a.busy} onClick={() => a.run(() => call('accounts.refresh', null))}>Balances</Button>}
      />
      <div className="px-[18px]">
        {s.accounts.map((acc, i) => (
          <div key={acc.index} className={`flex items-center gap-3 py-2.5 ${i < s.accounts.length - 1 ? 'rule-dash' : ''}`}>
            {acc.origins.length > 0 && <AppIcon name={acc.origins[0]} src={faviconFor(acc.origins[0])} size={24} />}
            <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[13px] font-semibold">{acc.label}</span>
              <span className="font-mono text-xs tnum text-second">{acc.balance == null ? '' : `${amount(acc.balance)} ETH`}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate font-mono text-[11px] text-muted">
                {short(acc.address)}
                {acc.origins.length > 0 && ` · ${acc.origins.join(', ')}`}
              </span>
              <Copy value={acc.address} />
            </div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 px-[18px] pt-4">
        <Input value={label} placeholder="Label" onChange={(e) => setLabel(e.target.value)} />
        <Button
          variant="ghost"
          className="flex-none"
          onClick={() => a.run(async () => {
            await call('accounts.create', { label });
            setLabel('');
          })}
        >
          New
        </Button>
      </div>
    </div>
  );
};
