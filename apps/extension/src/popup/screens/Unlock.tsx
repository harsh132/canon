import { useState } from 'react';
import type { CoreState } from '../../shared/protocol';
import { call, useAction } from '../client';
import { getPasskey } from '../passkey';
import { chooseDevice, hasDevice } from '../hardware';
import { Button, ErrorLine, Field, Header, Input, Slug } from '../ui';

export const Unlock = ({ s }: { s: CoreState }) => {
  const [password, setPassword] = useState('');
  const [reset, setReset] = useState(false);
  const a = useAction();
  const passkey = s.unlockWith?.kind === 'passkey';
  const hardware = s.unlockWith?.kind === 'hardware';
  const unlock = () =>
    a.run(async () => {
      if (hardware) {
        if (!(await hasDevice())) await chooseDevice();
        await call('vault.unlockHardware', null);
      } else if (passkey) await call('vault.unlockPasskey', { prf: (await getPasskey(s.unlockWith?.credentialId)).prf });
      else await call('vault.unlock', { password });
    });

  // A dapp request waiting behind the lock: say what it is, and allow declining
  // it without unlocking. After unlock the app shows the request itself.
  const { proposal, request } = s.wc;
  const pending = proposal ? `${proposal.name} wants to connect` : request ? `${request.dapp}: ${request.title.toLowerCase()}` : null;
  const reject = proposal
    ? () => a.run(() => call('wc.reject', null))
    : request
      ? () => a.run(() => call('wc.rejectRequest', null))
      : null;

  return (
    <div className="flex min-h-[var(--app-h)] flex-col">
      <Header title="Pangolin" />
      <div className="flex flex-1 flex-col gap-4 px-[18px] pt-24">
        {pending && (
          <div>
            <Slug>Unlock to review</Slug>
            <div className="mt-1 text-[15px] font-semibold">{pending}</div>
          </div>
        )}
        {!passkey && !hardware && (
          <Field label="Password">
            <Input type="password" value={password} autoFocus onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && unlock()} />
          </Field>
        )}
        <ErrorLine>{a.error}</ErrorLine>
        <Button busy={a.busy} onClick={unlock}>{hardware ? 'Unlock with device' : passkey ? 'Unlock with passkey' : 'Unlock'}</Button>
        {reject && (
          <Button variant="link" className="self-center text-muted" onClick={reject}>
            Reject request
          </Button>
        )}
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
