import { useRef, useState } from 'react';
import type { CoreState } from '../../shared/protocol';
import { NETS, tokensOn, type Token } from '../../shared/networks';
import { amount, short } from '../../shared/format';
import type { Tab } from '../App';
import { call, useAction } from '../client';
import { Button, Card, ErrorLine, Field, Header, Input, Row } from '../ui';

const SELECT = 'w-full rounded-sm border border-rule bg-sheet px-3 py-2.5 font-mono text-sm outline-none focus:border-accent';
const digits = (d: number) => (d > 6 ? 4 : 2);

/** The tokens Canon shows per network: the built-in ones and the user's own, saved in the encrypted book. */
export const Tokens = ({ s, go }: { s: CoreState; go: (t: Tab) => void }) => {
  const [chainId, setChainId] = useState(s.chainId);
  const [address, setAddress] = useState('');
  // The looked-up token, with the network it was read on; Add uses that network, not the select's.
  const [found, setFound] = useState<(Token & { chainId: number }) | null>(null);
  // Main's public balances, read only when asked.
  const [pub, setPub] = useState<Record<string, bigint> | null>(null);
  const a = useAction();
  // Only the newest balance read and the newest lookup may set state. A network change
  // invalidates both; an address change invalidates the lookup. So a reply started before
  // a change, or overtaken by a later request, never shows (even after A -> B -> A).
  const pubSeq = useRef(0);
  const lookSeq = useRef(0);
  const main = s.accounts.find((x) => x.index === 0);
  const list = tokensOn(chainId, s.tokens);
  const custom = new Set((s.tokens[chainId] ?? []).map((t) => t.address.toLowerCase()));
  // The private balance lives on the private network only.
  const priv = (t: Token) => (chainId === s.chainId ? (s.privateBalances.find((b) => b.token === t.address.toLowerCase())?.spendable ?? 0n) : null);

  const readPublic = () =>
    a.run(async () => {
      const mine = ++pubSeq.current;
      const b = await call('site.balances', { address: main!.address, chainId });
      if (pubSeq.current === mine) setPub(Object.fromEntries(b.tokens.map((t) => [t.address.toLowerCase(), t.amount])));
    });

  return (
    <div className="pb-[18px]">
      <Header title="Tokens" onBack={() => go('home')} right={main && <Button variant="link" busy={a.busy} onClick={readPublic}>Balances</Button>} />
      <div className="px-[18px]">
        <Field label="Network">
          <select
            value={chainId}
            onChange={(e) => {
              setChainId(Number(e.target.value));
              pubSeq.current += 1;
              lookSeq.current += 1;
              setPub(null);
              setFound(null);
            }}
            className={SELECT}
          >
            {NETS.map((n) => (
              <option key={n.chainId} value={n.chainId}>
                {n.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="px-[18px] pt-3">
        {list.map((t, i) => {
          const p = priv(t);
          const mine = custom.has(t.address.toLowerCase());
          return (
            <div key={t.address} className={`py-2.5 ${i < list.length - 1 ? 'rule-dash' : ''}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate font-mono text-[13px] font-bold">{t.symbol}</span>
                <span className="font-mono text-xs tnum text-second">
                  {pub && (t.address.toLowerCase() in pub ? `${amount(pub[t.address.toLowerCase()], t.decimals, digits(t.decimals))} public` : 'public unknown')}
                  {pub && p != null && ' · '}
                  {p != null && `${amount(p, t.decimals, digits(t.decimals))} private`}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate font-mono text-[11px] text-muted">
                  {short(t.address, 8, 6)}
                  {mine && ' · added'}
                </span>
                {mine && (
                  <Button variant="link" className="text-danger" disabled={a.busy} onClick={() => a.run(() => call('tokens.remove', { chainId, address: t.address }))}>
                    Remove
                  </Button>
                )}
              </div>
              {t.warning && <p className="pt-1 font-mono text-[11px] text-warn">{t.warning}</p>}
            </div>
          );
        })}
      </div>

      <div className="px-[18px] pt-4">
        <Field label="Add token" hint="contract address">
          <div className="flex gap-2">
            <Input
              value={address}
              spellCheck={false}
              placeholder="0x…"
              onChange={(e) => {
                setAddress(e.target.value);
                lookSeq.current += 1;
                setFound(null);
              }}
            />
            <Button variant="ghost" className="flex-none" busy={a.busy} disabled={!address.trim()} onClick={() =>
                a.run(async () => {
                  const mine = ++lookSeq.current;
                  const t = await call('tokens.lookup', { chainId, address });
                  if (lookSeq.current === mine) setFound({ ...t, chainId } as Token & { chainId: number });
                })
              }>
              Look up
            </Button>
          </div>
        </Field>
        {found && (
          <Card className="mt-3 px-[18px] pt-1 pb-3.5">
            <Row label="Symbol">{found.symbol}</Row>
            <Row label="Decimals">{found.decimals}</Row>
            <div className="py-2.5 font-mono text-[11px] break-all text-second">{found.address}</div>
            {found.warning && <p className="font-mono text-[11px] text-warn">{found.warning}</p>}
            <p className="pt-1 text-[12px] text-second">Anyone can make a token with any name. Add it only if you trust this address.</p>
            <Button
              className="mt-3 w-full"
              busy={a.busy}
              onClick={() =>
                a.run(async () => {
                  await call('tokens.add', { chainId: found.chainId, address: found.address });
                  setFound(null);
                  setAddress('');
                })
              }
            >
              Add {found.symbol}
            </Button>
          </Card>
        )}
        <div className="pt-2">
          <ErrorLine>{a.error}</ErrorLine>
        </div>
      </div>
    </div>
  );
};
