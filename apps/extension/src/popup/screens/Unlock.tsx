import { useState } from 'react';
import type { CoreState } from '../../shared/protocol';
import { call, useAction } from '../client';
import { Button, ErrorLine, Field, Header, Input, Slug } from '../ui';

export const Unlock = ({ s }: { s: CoreState }) => {
  const [password, setPassword] = useState('');
  const [reset, setReset] = useState(false);
  const a = useAction();
  const unlock = () => a.run(() => call('vault.unlock', { password }));
  const pending = s.wc.request ? 'Unlock to review a request' : null;

  return (
    <div className="flex min-h-[600px] flex-col">
      <Header title="Pangolin" />
      <div className="flex flex-1 flex-col gap-4 px-[18px] pt-24">
        {pending && <Slug className="text-accent">{pending}</Slug>}
        <Field label="Password">
          <Input type="password" value={password} autoFocus onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && unlock()} />
        </Field>
        <ErrorLine>{a.error}</ErrorLine>
        <Button busy={a.busy} onClick={unlock}>Unlock</Button>
        <div className="flex-1" />
        <div className="mb-[18px] flex justify-center">
          {reset ? (
            <Button variant="link" className="text-danger" onClick={() => a.run(() => call('vault.reset', null))}>
              Erase this wallet
            </Button>
          ) : (
            <Button variant="link" className="text-muted" onClick={() => setReset(true)}>Reset</Button>
          )}
        </div>
      </div>
    </div>
  );
};
