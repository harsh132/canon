import type { CoreState, Verification } from '../../shared/protocol';
import { short } from '../../shared/format';
import { call, useAction } from '../client';
import { Button, Card, ErrorLine, Header, Row, Slug } from '../ui';

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

  return (
    <div className="flex min-h-[var(--app-h)] flex-col">
      <Header title="Connect" right={<Slug className={trust.cls}>{trust.text}</Slug>} />
      <div className="px-[18px] pt-4">
        <div className="text-[19px] font-semibold">{p.name}</div>
        <div className="font-mono text-xs text-second">
          {p.origin ?? 'no origin'}
          {!p.attested && ' · self-declared'}
        </div>
      </div>
      <Card edge className="mx-[18px] mt-5 px-[18px] pt-4">
        <Slug>Sees</Slug>
        {p.account ? (
          <>
            <div className="mt-1 text-[17px] font-semibold">{p.account.isNew ? 'A new address' : p.account.label}</div>
            <div className="mt-3 border-t border-dashed border-rule">
              <Row label="Address">{short(p.account.address, 8, 6)}</Row>
              <Row label="Chain" last>Sepolia</Row>
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
      <Header title={r.dapp} right={<Slug>{r.account ? r.account.label : 'Unknown address'}</Slug>} />
      <div className="px-[18px] pt-2">
        <div className="text-[19px] font-semibold">{r.title}</div>
        {r.account && <div className="font-mono text-xs text-second">{short(r.account.address, 8, 6)}</div>}
      </div>
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
