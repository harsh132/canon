import { useState } from 'react';
import type { CoreState } from '../../shared/protocol';
import type { Tab } from '../App';
import { call, useAction } from '../client';
import { getPasskey } from '../passkey';
import { Button, Card, ErrorLine, Field, Header, Input, Slug } from '../ui';

/** The recovery phrase again, behind the password or passkey. Hidden when leaving. */
export const Phrase = ({ s, go }: { s: CoreState; go: (t: Tab) => void }) => {
  const passkey = s.unlockWith?.kind === 'passkey';
  const [password, setPassword] = useState('');
  const [phrase, setPhrase] = useState<string | null>(null);
  const a = useAction();
  const reveal = () =>
    a.run(async () => {
      const params = passkey ? { prf: (await getPasskey(s.unlockWith?.credentialId)).prf } : { password };
      setPhrase((await call('vault.reveal', params)).mnemonic);
      setPassword('');
    });

  return (
    <div className="flex min-h-[calc(var(--app-h)-var(--chrome-h))] flex-col">
      <Header title="Recovery phrase" onBack={() => go('home')} />
      <div className="flex flex-1 flex-col gap-4 px-[18px] pt-2">
        {phrase ? (
          <>
            <Card edge className="p-4">
              <ol className="grid grid-cols-3 gap-x-3 gap-y-2.5 font-mono text-[13px]">
                {phrase.split(' ').map((w, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="w-4 text-right text-muted tnum">{i + 1}</span>
                    {w}
                  </li>
                ))}
              </ol>
            </Card>
            <Slug className="text-warn">Anyone with these words has this wallet.</Slug>
            <div className="flex-1" />
            <Button className="mb-[18px]" onClick={() => setPhrase(null)}>
              Hide
            </Button>
          </>
        ) : (
          <>
            {!passkey && (
              <Field label="Password">
                <Input type="password" value={password} autoFocus onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && reveal()} />
              </Field>
            )}
            <ErrorLine>{a.error}</ErrorLine>
            <div className="flex-1" />
            <Button className="mb-[18px]" busy={a.busy} onClick={reveal}>
              {passkey ? 'Show with passkey' : 'Show'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

/** Erase the wallet from this device, one confirm away. */
export const Reset = ({ go }: { go: (t: Tab) => void }) => {
  const a = useAction();
  return (
    <div className="flex min-h-[calc(var(--app-h)-var(--chrome-h))] flex-col">
      <Header title="Reset" onBack={() => go('home')} />
      <div className="flex flex-1 flex-col gap-4 px-[18px] pt-2">
        <p className="text-[15px] leading-snug">Erases this wallet from this device. Only the recovery phrase or passkey brings it back.</p>
        <ErrorLine>{a.error}</ErrorLine>
        <div className="flex-1" />
        <Button className="mb-[18px] bg-danger hover:bg-danger" busy={a.busy} onClick={() => a.run(() => call('vault.reset', null))}>
          Erase this wallet
        </Button>
      </div>
    </div>
  );
};
