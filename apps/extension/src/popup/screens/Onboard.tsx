import { useState } from 'react';
import { call, useAction } from '../client';
import { Button, Card, ErrorLine, Field, Header, Input, Slug } from '../ui';

export const Onboard = ({ onBackup }: { onBackup: (phrase: string) => void }) => {
  const [mode, setMode] = useState<'create' | 'import'>('create');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [phrase, setPhrase] = useState('');
  const a = useAction();

  const submit = () =>
    a.run(async () => {
      if (password !== confirm) throw new Error('Passwords differ');
      if (mode === 'create') {
        const { mnemonic } = await call('vault.create', { password });
        onBackup(mnemonic);
      } else {
        await call('vault.import', { password, mnemonic: phrase });
      }
    });

  return (
    <div className="flex min-h-[var(--app-h)] flex-col">
      <Header title="Pangolin" />
      <div className="flex flex-1 flex-col gap-4 px-[18px] pt-6">
        <div className="grid grid-cols-2 gap-2">
          {(['create', 'import'] as const).map((m) => (
            <Button key={m} variant={mode === m ? 'primary' : 'ghost'} onClick={() => setMode(m)}>
              {m === 'create' ? 'New wallet' : 'Import'}
            </Button>
          ))}
        </div>
        {mode === 'import' && (
          <Field label="Recovery phrase">
            <textarea
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              rows={3}
              className="w-full rounded-sm border border-rule bg-sheet px-3.5 py-2.5 font-mono text-sm outline-none focus:border-accent"
            />
          </Field>
        )}
        <Field label="Password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </Field>
        <Field label="Again">
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </Field>
        <ErrorLine>{a.error}</ErrorLine>
        <div className="flex-1" />
        <Button className="mb-[18px]" busy={a.busy} onClick={submit}>
          {mode === 'create' ? 'Create' : 'Import'}
        </Button>
      </div>
    </div>
  );
};

export const Backup = ({ phrase, onDone }: { phrase: string; onDone: () => void }) => (
  <div className="flex min-h-[var(--app-h)] flex-col">
    <Header title="Recovery phrase" />
    <div className="flex flex-1 flex-col gap-4 px-[18px] pt-4">
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
      <Slug className="text-warn">Write it down. Shown once.</Slug>
      <div className="flex-1" />
      <Button className="mb-[18px]" onClick={onDone}>
        Saved it
      </Button>
    </div>
  </div>
);
