import type { CoreState } from '../../shared/protocol';
import type { Tab } from '../App';
import { call, useAction } from '../client';
import { Button, Card, ErrorLine, Header, Row, Slug } from '../ui';

export const Privacy = ({ s, go }: { s: CoreState; go: (t: Tab) => void }) => {
  const { mode, status, counts, error, bootMs } = s.rpc;
  const a = useAction();
  const nox = mode === 'nox';
  const leaked = counts.clear;

  return (
    <div className="flex min-h-[560px] flex-col">
      <Header title="Privacy" onBack={() => go('home')} right={<Slug>This session</Slug>} />
      <Card edge className="mx-[18px] mt-2.5 px-[18px] pt-[18px]">
        <div className="flex items-start justify-between">
          <div>
            <Slug>Network reads</Slug>
            <div className="mt-2 flex items-baseline gap-2 font-mono tnum">
              <span className="text-[38px] leading-none font-bold tracking-tight">{counts.mixed}</span>
              <span className="text-[13px] text-second">via Nox</span>
            </div>
          </div>
          {nox && status === 'ready' && leaked === 0 && <span className="stamp mt-1.5">Nothing leaked</span>}
        </div>
        <div className="mt-3.5 border-t border-dashed border-rule">
          <Row label="Route">{nox ? `Nox · ${status}${bootMs ? ` ${(bootMs / 1000).toFixed(1)}s` : ''}` : 'Direct'}</Row>
          <Row label="Clear RPC">
            <span className={leaked ? 'text-warn' : ''}>{leaked}</span>
          </Row>
          <Row label="Bootstrap">{counts.bootstrap} · names Nox only</Row>
          <Row label="Bulk sync">{counts.sync + counts.artifacts} · public data</Row>
          <Row label="Other" last>{counts.other}</Row>
        </div>
      </Card>
      <div className="flex-1" />
      <div className="flex flex-col gap-2 px-[18px] pb-[18px]">
        <ErrorLine>{a.error ?? (status === 'error' ? error : null)}</ErrorLine>
        <Button
          variant={nox ? 'ghost' : 'primary'}
          busy={a.busy}
          onClick={() => a.run(() => call('rpc.setMode', { mode: nox ? 'direct' : 'nox' }))}
        >
          {nox ? 'Use direct RPC' : 'Route through Nox'}
        </Button>
      </div>
    </div>
  );
};
