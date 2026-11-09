import { useEffect, useState } from 'react';
import type { CoreState, SendIntent, SendKind, SendPlan } from '../../shared/protocol';
import { amount, isZk, short } from '../../shared/format';
import { tokensOn } from '../../shared/networks';
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
  const [via, setVia] = useState<'sponsor' | 'broadcaster' | 'self'>(process.env.CANON_FORK === '1' ? 'self' : 'sponsor');
  const [tokenAddr, setTokenAddr] = useState('');
  // A public account's token balance, read when the user picks the token.
  const [pubToken, setPubToken] = useState<bigint | null>(null);
  const a = useAction();

  // ETH, or an ERC-20 on the private network. Only the built-in WETH is called exactly "WETH" (checkToken), and it is ETH here.
  const tokens = tokensOn(s.chainId, s.tokens).filter((t) => t.symbol !== 'WETH');
  const token = tokens.find((t) => t.address === tokenAddr) ?? null;
  const decimals = token?.decimals ?? 18;
  const account = from === 'private' ? null : s.accounts.find((x) => x.index === from);
  useEffect(() => {
    setPubToken(null);
    if (!token || !account) return;
    void call('site.balances', { address: account.address, chainId: s.chainId }).then(
      (b) => setPubToken(b.tokens.find((t) => t.address === token.address)?.amount ?? null),
      () => {},
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token?.address, account?.address]);

  const intent: SendIntent = { from, to, amount: value, gasFrom: 0, via, ...(token ? { token: token.address } : {}) };
  const priv = (token ? s.privateBalances.find((b) => b.token === token.address.toLowerCase()) : s.privateBalances[0])?.spendable ?? 0n;
  const fromBalance = from === 'private' ? priv : token ? pubToken : (account?.balance ?? null);
  const unit = token?.symbol ?? 'ETH'; // Private WETH is shown as ETH; it leaves as ETH.
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
          {unit} · {amount(fromBalance, decimals)}
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
            <option value="private">Private · {amount(priv, decimals)} {unit}</option>
            {s.accounts.map((acc) => (
              <option key={acc.index} value={acc.index}>
                {acc.label} · {short(acc.address)}
              </option>
            ))}
          </select>
        </Field>
        {tokens.length > 0 && (
          <Field label="Token">
            <select
              value={tokenAddr}
              onChange={(e) => {
                setTokenAddr(e.target.value);
                setPlan(null);
              }}
              className="w-full rounded-sm border border-rule bg-sheet px-3 py-2.5 font-mono text-sm outline-none focus:border-accent"
            >
              <option value="">ETH</option>
              {tokens.map((t) => (
                <option key={t.address} value={t.address}>
                  {t.symbol} · {short(t.address)}
                </option>
              ))}
            </select>
            {token?.warning && <p className="pt-1.5 font-mono text-[11px] text-warn">{token.warning}</p>}
          </Field>
        )}
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
            {token && <Row label="Token">{plan.symbol} · {short(token.address, 8, 6)}</Row>}
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
