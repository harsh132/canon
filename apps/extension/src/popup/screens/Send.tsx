import { useState } from 'react';
import type { CoreState, SendIntent, SendKind, SendPlan } from '../../shared/protocol';
import { amount, isZk, short } from '../../shared/format';
import type { Tab } from '../App';
import { call, useAction } from '../client';
import { Button, Card, ErrorLine, Field, Header, Input, Meta, Row, Slug, etherscan } from '../ui';

const VERB: Record<SendKind, string> = {
  send: 'Send publicly',
  shield: 'Make private',
  transfer: 'Send privately',
  unshield: 'Make public',
};

// One line on what becomes visible. Kept to a fragment on purpose.
const SEEN: Record<SendKind, string> = {
  send: 'Public on-chain',
  shield: 'Your address, once',
  transfer: 'Nothing',
  unshield: 'Recipient and amount',
};

export const Send = ({ s, go }: { s: CoreState; go: (t: Tab) => void }) => {
  const [from, setFrom] = useState<'private' | number>('private');
  const [to, setTo] = useState('');
  const [value, setValue] = useState('');
  const [plan, setPlan] = useState<SendPlan | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [via, setVia] = useState<'sponsor' | 'broadcaster' | 'self'>(process.env.PANGOLIN_FORK === '1' ? 'self' : 'sponsor');
  const a = useAction();

  const intent: SendIntent = { from, to, amount: value, gasFrom: 0, via };
  const priv = s.privateBalances[0]?.spendable ?? 0n;
  const fromBalance = from === 'private' ? priv : (s.accounts.find((x) => x.index === from)?.balance ?? null);
  const unit = 'ETH'; // Private WETH is shown as ETH; it leaves as ETH.
  const gasLabel = (i: number | null) => (i == null ? '' : (s.accounts.find((x) => x.index === i)?.label ?? `#${i}`));

  if (hash) {
    return (
      <div>
        <Header title="Sent" onBack={() => go('home')} />
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
    <div className="flex min-h-[calc(var(--app-h)-var(--chrome-h))] flex-col">
      <Meta>
        <Slug>
          {unit} · {amount(fromBalance)}
        </Slug>
      </Meta>
      <div className="flex flex-col gap-4 px-[18px] pt-2.5">
        <Field label="From">
          <select
            value={String(from)}
            onChange={(e) => {
              setFrom(e.target.value === 'private' ? 'private' : Number(e.target.value));
              setPlan(null);
            }}
            className="w-full rounded-sm border border-rule bg-sheet px-3 py-2.5 font-mono text-sm outline-none focus:border-accent"
          >
            <option value="private">Private · {amount(priv)} ETH</option>
            {s.accounts.map((acc) => (
              <option key={acc.index} value={acc.index}>
                {acc.label} · {short(acc.address)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="To" hint="name, 0x or 0zk">
          <Input
            value={to}
            spellCheck={false}
            onChange={(e) => {
              setTo(e.target.value);
              setPlan(null);
            }}
            placeholder={from === 'private' ? '0zk…' : '0x…'}
          />
        </Field>
        {s.railgunAddress && from !== 'private' && !isZk(to) && (
          <Button variant="link" className="self-start" onClick={() => { setTo(s.railgunAddress!); setPlan(null); }}>
            To my private balance
          </Button>
        )}
        {from === 'private' && (
          <Field label="Gas" hint={via === 'broadcaster' ? `${s.broadcaster.count} online` : via === 'self' ? 'links Main' : 'free on Sepolia'}>
            <div className="grid grid-cols-3 gap-2">
              {(['sponsor', 'broadcaster', 'self'] as const).map((v) => (
                <Button key={v} variant={via === v ? 'primary' : 'ghost'} className="px-1 py-2" onClick={() => { setVia(v); setPlan(null); }}>
                  {v === 'sponsor' ? 'Sponsor' : v === 'broadcaster' ? 'Broadcaster' : 'Main'}
                </Button>
              ))}
            </div>
          </Field>
        )}
        <Field label="Amount">
          <div className="flex items-center rounded-sm border border-rule bg-sheet px-3.5 py-2.5 focus-within:border-accent">
            <input
              value={value}
              inputMode="decimal"
              onChange={(e) => {
                setValue(e.target.value);
                setPlan(null);
              }}
              placeholder="0.00"
              className="min-w-0 flex-1 bg-transparent font-mono text-[22px] font-bold outline-none"
            />
            <span className="font-mono text-[13px] text-second">{unit}</span>
          </div>
        </Field>
      </div>

      {plan && (
        <Card edge className="mx-[18px] mt-[18px] px-[18px] pt-4">
          <Slug>This will</Slug>
          <div className="mt-1 text-[17px] font-semibold">{VERB[plan.kind]}</div>
          <div className="mt-3 border-t border-dashed border-rule">
            {plan.name && <Row label="Pays">{short(plan.to, 10, 6)}</Row>}
            {plan.name && <Row label="Via">{plan.resolvedVia === 'org.railgun' ? 'org.railgun record' : 'ETH address record'}</Row>}
            <Row label="Seen">{SEEN[plan.kind]}</Row>
            {plan.broadcasterFee != null ? (
              <Row label="Fee">{plan.broadcasterFee === 0n ? 'Sponsored' : `${amount(plan.broadcasterFee, 18, 6)} ETH · broadcaster`}</Row>
            ) : (
              <Row label="Fee">{plan.gasFee > 0n && plan.gasFee < 1_000_000_000_000n ? '< 0.000001' : amount(plan.gasFee, 18, 6)} ETH</Row>
            )}
            {plan.gasFrom != null && <Row label="Gas from">{gasLabel(plan.gasFrom)} · public</Row>}
            {plan.needsProof && <Row label="Proof" last>on this device</Row>}
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
        {plan ? (
          <Button busy={a.busy} onClick={() => a.run(async () => setHash((await call('send.execute', { ...intent, to: plan.to })).hash))}>
            {VERB[plan.kind]}
          </Button>
        ) : (
          <Button busy={a.busy} disabled={!to || !value} onClick={() => a.run(async () => setPlan(await call('send.plan', intent)))}>
            Review
          </Button>
        )}
      </div>
    </div>
  );
};
