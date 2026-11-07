import { useState } from 'react';
import type { CoreState } from '../../shared/protocol';
import { short } from '../../shared/format';
import type { Tab } from '../App';
import { call, useAction } from '../client';
import { Button, Card, Copy, ErrorLine, Header, Row, Slug } from '../ui';

export const Name = ({ s, go }: { s: CoreState; go: (t: Tab) => void }) => {
  const [label, setLabel] = useState('');
  const a = useAction();
  const owner = s.accounts.find((x) => x.label === 'Name owner');

  if (s.name) {
    return (
      <div>
        <Header title="Your name" onBack={() => go('home')} right={<Slug>ENSv2 · Sepolia</Slug>} />
        <Card edge className="mx-[18px] mt-2.5 px-[18px] pt-[18px]">
          <div className="flex items-start justify-between">
            <div className="font-mono text-[20px] font-bold break-all">{s.name}</div>
            <span className="stamp mt-1 shrink-0">Yours</span>
          </div>
          <div className="mt-4 border-t border-dashed border-rule">
            <Row label="Pays">{s.railgunAddress ? short(s.railgunAddress, 10, 6) : '…'}</Row>
            <Row label="Owner">{owner ? `${short(owner.address)} · no funds` : '—'}</Row>
            <Row label="Expires" last>never</Row>
          </div>
        </Card>
        <div className="flex justify-center pt-4">
          <Copy value={s.name} label="Copy name" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(var(--app-h)-var(--chrome-h))] flex-col">
      <Header title="Your name" onBack={() => go('home')} right={<Slug>ENSv2 · Sepolia</Slug>} />
      <div className="px-[18px] pt-2.5">
        <div className="flex items-center rounded-sm border border-rule bg-sheet px-3.5 py-2.5 focus-within:border-accent">
          <input
            value={label}
            autoFocus
            spellCheck={false}
            aria-label="Name label"
            onChange={(e) => setLabel(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="alice"
            className="min-w-0 flex-1 bg-transparent font-mono text-[18px] font-bold outline-none"
          />
          <span className="font-mono text-[13px] text-second">.canon.eth</span>
        </div>
      </div>
      <Card edge className="mx-[18px] mt-[18px] px-[18px] pt-4">
        <Slug>Written on-chain</Slug>
        <div className="mt-1 border-t border-dashed border-rule">
          <Row label="Owner">new address · no funds</Row>
          <Row label="Record">org.railgun → your 0zk</Row>
          <Row label="Expires">never</Row>
          <Row label="Sponsor" last>no control after issue</Row>
        </div>
      </Card>
      <div className="flex-1" />
      <div className="flex flex-col gap-2 px-[18px] pt-4 pb-[18px]">
        <ErrorLine>{a.error}</ErrorLine>
        <Button busy={a.busy} disabled={label.length < 3 || !s.railgunAddress} onClick={() => a.run(() => call('ens.claim', { label }))}>
          Claim {label || '…'}.canon.eth
        </Button>
        <div className="flex justify-between">
          <Slug>Free · sponsored</Slug>
          <Slug>Label is public</Slug>
        </div>
      </div>
    </div>
  );
};
