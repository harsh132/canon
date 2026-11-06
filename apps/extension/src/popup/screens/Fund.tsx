import { useState } from 'react';
import { parseUnits } from 'ethers';
import type { CoreState, TokenBalance } from '../../shared/protocol';
import { amount, short } from '../../shared/format';
import { call, useAction } from '../client';
import { AppIcon, Button, Card, ErrorLine, Field, Header, Row, Slug, etherscan, faviconFor } from '../ui';

/** Fund a site's public address from the private balance (panel only). */
export const Fund = ({ s, address, origin, onDone }: { s: CoreState; address: string; origin: string; onDone: () => void }) => {
  const tokens = s.privateBalances.filter((b) => b.spendable > 0n);
  const [token, setToken] = useState<TokenBalance | null>(tokens.length === 1 ? tokens[0] : null);
  const [value, setValue] = useState('');
  const [hash, setHash] = useState<string | null>(null);
  const a = useAction();
  const asEth = token?.symbol === 'WETH';

  if (hash) {
    return (
      <div>
        <Header title="Funded" onBack={onDone} />
        <div className="flex flex-col items-center gap-5 px-[18px] pt-16">
          <span className="stamp">Submitted</span>
          <a className="font-mono text-xs text-accent" href={etherscan(hash)} target="_blank" rel="noreferrer">
            {short(hash, 10, 8)}
          </a>
          <Button variant="ghost" onClick={onDone}>Done</Button>
        </div>
      </div>
    );
  }

  let parsed: bigint | null = null;
  try {
    parsed = token && value ? parseUnits(value, token.decimals) : null;
  } catch {
    parsed = null;
  }

  return (
    <div className="flex min-h-[calc(var(--app-h)-44px)] flex-col">
      <Header title="Fund" onBack={onDone} right={<Slug>From private</Slug>} />
      <div className="flex items-center gap-3 px-[18px] pt-1">
        <AppIcon name={origin} src={faviconFor(origin)} size={28} />
        <div className="min-w-0">
          <div className="truncate font-mono text-[14px] font-bold">{origin}</div>
          <div className="font-mono text-[11px] text-muted">{short(address, 8, 6)}</div>
        </div>
      </div>

      <div className="px-[18px] pt-4">
        <Slug>Token</Slug>
        {tokens.length === 0 && <p className="py-3 font-mono text-xs text-muted">Nothing spendable yet</p>}
        <div className="mt-2 flex flex-col gap-2">
          {tokens.map((t) => (
            <button
              key={t.token}
              onClick={() => {
                setToken(t);
                setValue('');
              }}
              className={`flex items-baseline justify-between rounded-sm border px-3.5 py-2.5 font-mono text-[13px] ${token?.token === t.token ? 'border-accent' : 'border-rule'}`}
            >
              <span className="font-bold">{t.symbol === 'WETH' ? 'ETH' : t.symbol}</span>
              <span className="tnum text-second">{amount(t.spendable, t.decimals, t.decimals > 6 ? 4 : 2)}</span>
            </button>
          ))}
        </div>
      </div>

      {token && (
        <div className="px-[18px] pt-4">
          <Field label="Amount" hint={<button className="text-accent" onClick={() => setValue(amount(token.spendable, token.decimals, token.decimals))}>Max</button>}>
            <div className="flex items-center rounded-sm border border-rule bg-sheet px-3.5 py-2.5 focus-within:border-accent">
              <input
                value={value}
                inputMode="decimal"
                onChange={(e) => setValue(e.target.value)}
                placeholder="0.00"
                className="min-w-0 flex-1 bg-transparent font-mono text-[20px] font-bold outline-none"
              />
              <span className="font-mono text-[13px] text-second">{asEth ? 'ETH' : token.symbol}</span>
            </div>
          </Field>
        </div>
      )}

      {token && parsed != null && parsed > 0n && (
        <Card edge className="mx-[18px] mt-4 px-[18px] pt-4">
          <Slug>This will</Slug>
          <div className="mt-1 text-[17px] font-semibold">Make public to this site's address</div>
          <div className="mt-3 border-t border-dashed border-rule">
            <Row label="Arrives as">{asEth ? 'ETH' : token.symbol}</Row>
            <Row label="Seen">Amount and this address</Row>
            <Row label="Fee" last>0.25% · gas sponsored</Row>
          </div>
        </Card>
      )}

      {s.proof && (
        <div className="mx-[18px] mt-4">
          <div className="flex justify-between"><Slug>{s.proof.label}</Slug><Slug>{Math.round(s.proof.progress * 100)}%</Slug></div>
          <div className="mt-1.5 h-1 rounded-full bg-rule"><div className="h-1 rounded-full bg-accent" style={{ width: `${s.proof.progress * 100}%` }} /></div>
        </div>
      )}

      <div className="flex-1" />
      <div className="flex flex-col gap-2 px-[18px] pt-4 pb-[18px]">
        <ErrorLine>{a.error}</ErrorLine>
        <Button
          busy={a.busy}
          disabled={!token || parsed == null || parsed <= 0n || parsed > token.spendable}
          onClick={() => a.run(async () => setHash((await call('site.fund', { address, token: token!.token, amount: parsed! })).hash))}
        >
          Fund
        </Button>
      </div>
    </div>
  );
};
