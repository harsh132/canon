import type { CoreState, Verification } from '../../shared/protocol';
import { short } from '../../shared/format';
import { call, useAction } from '../client';
import { AppIcon, Button, Card, ErrorLine, Header, Row, Slug, faviconFor } from '../ui';
import { SEPOLIA_ID, netOf } from '../../shared/networks';

const TRUST: Record<Verification, { text: string; cls: string }> = {
  VALID: { text: 'Verified', cls: 'text-accent' },
  UNKNOWN: { text: 'Unverified', cls: 'text-muted' },
  INVALID: { text: 'Mismatch', cls: 'text-danger' },
  SCAM: { text: 'Scam', cls: 'text-danger' },
  BROWSER: { text: 'This tab', cls: 'text-accent' },
};

export const ConnectPrompt = ({ s }: { s: CoreState }) => {
  const p = s.wc.proposal!;
  const a = useAction();
  const trust = TRUST[p.verification];
  // Hide the app name when it only repeats the origin (browser dapps).
  const showName = p.name !== p.origin && p.name !== p.origin?.replace(/^[a-z]+:\/\//, '');

  return (
    <div className="flex min-h-[var(--app-h)] flex-col">
      <Header title="Connect" right={<Slug className={trust.cls}>{trust.text}</Slug>} />
      {/* The origin is the line a site cannot fake, so it leads; the icon and
          the app's own name are secondary. */}
      <div className="flex items-center gap-3 px-[18px] pt-4">
        <AppIcon name={p.origin ?? p.name} src={p.source === 'browser' ? faviconFor(p.origin) : p.icon} size={36} />
        <div className="min-w-0">
          <div className="truncate font-mono text-[17px] font-bold">{p.origin ?? 'no origin'}</div>
          <div className="truncate text-xs text-second">
            {showName ? p.name : ''}
            {!p.attested && `${showName ? ' · ' : ''}self-declared`}
          </div>
        </div>
      </div>
      <Card edge className="mx-[18px] mt-5 px-[18px] pt-4">
        <Slug>Sees</Slug>
        {p.account ? (
          <>
            <div className="mt-1 text-[17px] font-semibold">{p.account.isNew ? 'A new address' : p.account.label}</div>
            <div className="mt-3 border-t border-dashed border-rule">
              <Row label="Address">{short(p.account.address, 8, 6)}</Row>
              <Row label="Network" last>{netOf((p.origin && s.siteChains[p.origin]) || SEPOLIA_ID)?.name}</Row>
            </div>
          </>
        ) : (
          <div className="mt-1 text-[15px] text-second">Unlock to pick an address</div>
        )}
      </Card>
      {p.account && s.accounts.length > 0 && (
        <div className="px-[18px] pt-4">
          <select
            value={p.account.isNew ? 'new' : String(p.account.index)}
            onChange={(e) => void call('wc.chooseAccount', { index: e.target.value === 'new' ? 'new' : Number(e.target.value) })}
            className="w-full rounded-sm border border-rule bg-sheet px-3 py-2.5 font-mono text-xs outline-none focus:border-accent"
          >
            <option value="new">New address</option>
            {s.accounts.map((acc) => (
              <option key={acc.index} value={acc.index}>
                {acc.label} · {short(acc.address)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex-1" />
      <div className="flex flex-col gap-2 px-[18px] pb-[18px]">
        <ErrorLine>{a.error ?? p.problem}</ErrorLine>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={() => a.run(() => call('wc.reject', null))}>Reject</Button>
          <Button busy={a.busy} disabled={!p.account || !p.canApprove} onClick={() => a.run(() => call('wc.approve', null))}>
            Connect
          </Button>
        </div>
      </div>
    </div>
  );
};


export const RequestPrompt = ({ s }: { s: CoreState }) => {
  const r = s.wc.request!;
  const a = useAction();
  return (
    <div className="flex min-h-[var(--app-h)] flex-col">
      <Header title={r.title} right={<Slug>{r.account ? r.account.label : 'Unknown address'}</Slug>} />
      <div className="flex items-center gap-3 px-[18px] pt-2">
        <AppIcon name={r.origin ?? r.dapp} src={r.source === 'browser' ? faviconFor(r.origin) : r.icon} size={36} />
        <div className="min-w-0">
          <div className="truncate font-mono text-[17px] font-bold">{r.origin ?? r.dapp}</div>
          {r.account && <div className="font-mono text-xs text-second">as {short(r.account.address, 8, 6)}</div>}
        </div>
      </div>
      {r.network && <Slug className="mx-[18px] mt-3">On {r.network}</Slug>}
      <Card className="mx-[18px] mt-4 max-h-[300px] overflow-auto px-4 py-3">
        <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">{r.detail}</pre>
      </Card>
      {r.isTransaction && <Slug className="mx-[18px] mt-3 text-warn">Public transaction</Slug>}
      <div className="flex-1" />
      <div className="flex flex-col gap-2 px-[18px] pb-[18px]">
        <ErrorLine>{a.error}</ErrorLine>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={() => a.run(() => call('wc.rejectRequest', null))}>Reject</Button>
          <Button busy={a.busy} disabled={!r.account} onClick={() => a.run(() => call('wc.approveRequest', null))}>
            {r.isTransaction ? 'Send' : 'Sign'}
          </Button>
        </div>
      </div>
    </div>
  );
};
