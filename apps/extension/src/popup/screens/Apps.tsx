import { useState } from 'react';
import type { CoreState } from '../../shared/protocol';
import { short } from '../../shared/format';
import { call, useAction } from '../client';
import { Button, ErrorLine, Field, Header, Input, Slug, AppIcon, faviconFor } from '../ui';

export const Apps = ({ s }: { s: CoreState }) => {
  const [uri, setUri] = useState('');
  const a = useAction();
  const label = (addr: string) => s.accounts.find((x) => x.address.toLowerCase() === addr.toLowerCase())?.label ?? short(addr);

  return (
    <div>
      <Header title="Apps" right={<Slug>WalletConnect</Slug>} />
      <div className="flex flex-col gap-3 px-[18px] pt-2.5">
        {!s.wc.configured ? (
          <Slug className="text-warn">No project id in this build</Slug>
        ) : (
          <>
            <Field label="Pairing link">
              <Input value={uri} spellCheck={false} placeholder="wc:…" onChange={(e) => setUri(e.target.value)} />
            </Field>
            <ErrorLine>{a.error ?? s.wc.error}</ErrorLine>
            <Button
              busy={a.busy}
              disabled={!uri || !s.wc.ready}
              onClick={() => a.run(async () => {
                await call('wc.pair', { uri });
                setUri('');
              })}
            >
              Connect
            </Button>
          </>
        )}
      </div>
      {s.sites.length > 0 && (
        <div className="px-[18px] pt-6">
          <Slug>Browser</Slug>
          {s.sites.map((x, i) => (
            <div key={x.origin} className={`flex items-center justify-between gap-3 py-2.5 ${i < s.sites.length - 1 ? 'rule-dash' : ''}`}>
              <AppIcon name={x.origin} src={faviconFor(x.origin)} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{x.origin}</div>
                <div className="font-mono text-[11px] text-muted">as {label(x.address)}</div>
              </div>
              <Button variant="link" className="text-muted" onClick={() => a.run(() => call('dapp.disconnect', { origin: x.origin }))}>
                Disconnect
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="px-[18px] pt-6">
        <Slug>WalletConnect</Slug>
        {s.wc.sessions.length === 0 && <p className="py-3 font-mono text-xs text-muted">None</p>}
        {s.wc.sessions.map((x, i) => (
          <div key={x.topic} className={`flex items-center justify-between gap-3 py-2.5 ${i < s.wc.sessions.length - 1 ? 'rule-dash' : ''}`}>
            <AppIcon name={x.name} src={x.icon} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{x.name}</div>
              <div className="font-mono text-[11px] text-muted">as {label(x.address)}</div>
            </div>
            <Button variant="link" className="text-muted" onClick={() => a.run(() => call('wc.disconnect', { topic: x.topic }))}>
              Disconnect
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};
