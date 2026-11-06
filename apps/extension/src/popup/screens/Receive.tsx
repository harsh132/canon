import type { CoreState } from '../../shared/protocol';
import type { Tab } from '../App';
import { Card, Copy, Header, Slug } from '../ui';

export const Receive = ({ s, go }: { s: CoreState; go: (t: Tab) => void }) => {
  const main = s.accounts.find((a) => a.index === 0);
  return (
    <div>
      <Header title="Receive" onBack={() => go('home')} />
      <div className="flex flex-col gap-4 px-[18px] pt-2.5">
        <Card edge className="px-[18px] pt-4">
          <div className="flex items-baseline justify-between">
            <Slug>Private · 0zk</Slug>
            {s.railgunAddress && <Copy value={s.railgunAddress} />}
          </div>
          <p className="mt-2 font-mono text-xs leading-relaxed break-all">{s.railgunAddress ?? '…'}</p>
        </Card>
        {main && (
          <Card className="px-[18px] py-4">
            <div className="flex items-baseline justify-between">
              <Slug>Public · {main.label}</Slug>
              <Copy value={main.address} />
            </div>
            <p className="mt-2 font-mono text-xs break-all">{main.address}</p>
          </Card>
        )}
      </div>
    </div>
  );
};
