import { useState } from 'react';
import type { CoreState } from '../../shared/protocol';
import { amount, short } from '../../shared/format';
import type { Tab } from '../App';
import { call, useAction } from '../client';
import { Button, Card, ErrorLine, Field, Header, Row, Slug, etherscan } from '../ui';

export const Swap = ({ s, go }: { s: CoreState; go: (t: Tab) => void }) => {
  const [value, setValue] = useState('');
  const [quote, setQuote] = useState<{ swapped: bigint; out: bigint; minOut: bigint } | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const a = useAction();
  const weth = s.privateBalances.find((b) => b.symbol === 'WETH');

  if (hash) {
    return (
      <div>
        <Header title="Swapped" onBack={() => go('home')} />
        <div className="flex flex-col items-center gap-5 px-[18px] pt-16">
          <span className="stamp">Submitted</span>
          <a className="font-mono text-xs text-accent" href={etherscan(hash)} target="_blank" rel="noreferrer">
            {short(hash, 10, 8)}
          </a>
          <Button variant="ghost" onClick={() => go('home')}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(var(--app-h)-44px)] flex-col">
      <Header title="Swap" onBack={() => go('home')} right={<Slug>Uniswap v4</Slug>} />
      <div className="px-[18px] pt-2.5">
        <Field label="Pay" hint={`${amount(weth?.spendable ?? 0n)} private`}>
          <div className="flex items-center rounded-sm border border-rule bg-sheet px-3.5 py-2.5 focus-within:border-accent">
            <input
              value={value}
              inputMode="decimal"
              onChange={(e) => {
                setValue(e.target.value);
                setQuote(null);
              }}
              placeholder="0.00"
              className="min-w-0 flex-1 bg-transparent font-mono text-[22px] font-bold outline-none"
            />
            <span className="font-mono text-[13px] text-second">WETH</span>
          </div>
        </Field>
      </div>
      {quote && (
        <Card edge className="mx-[18px] mt-[18px] px-[18px] pt-4">
          <Slug>This will</Slug>
          <div className="mt-1 text-[17px] font-semibold">Swap privately</div>
          <div className="mt-3 border-t border-dashed border-rule">
            <Row label="Get">≈ {amount(quote.out, 6, 2)} USDC</Row>
            <Row label="At least">{amount(quote.minOut, 6, 2)} USDC</Row>
            <Row label="Pool">ETH/USDC 0.3%</Row>
            <Row label="Seen">A swap by RAILGUN</Row>
            <Row label="Gas" last>Sponsored</Row>
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
        {quote ? (
          <Button busy={a.busy} onClick={() => a.run(async () => setHash((await call('swap.execute', { amount: value })).hash))}>
            Swap privately
          </Button>
        ) : (
          <Button busy={a.busy} disabled={!value} onClick={() => a.run(async () => setQuote(await call('swap.quote', { amount: value })))}>
            Quote
          </Button>
        )}
      </div>
    </div>
  );
};
