import { useMemo, useState } from 'react';
import { wordlists } from 'ethers';
import { call, useAction } from '../client';
import { createPasskey, getPasskey } from '../passkey';
import { chooseDevice } from '../hardware';
import type { HwLink } from '../../shared/hwframe';
import { Button, Card, ErrorLine, Field, Header, Input, Slug } from '../ui';

export type BackupView = { phrase: string; optional: boolean };

type Step = 'welcome' | 'create' | 'passkey' | 'restore' | 'hardware';

const isWord = (w: string): boolean => {
  try {
    return wordlists.en.getWordIndex(w) >= 0;
  } catch {
    return false;
  }
};

const Choice = ({ title, hint, onClick }: { title: string; hint: string; onClick: () => void }) => (
  <button onClick={onClick} className="flex items-baseline justify-between rounded-sm border border-rule px-4 py-3.5 text-left hover:border-accent">
    <span className="text-[15px] font-semibold">{title}</span>
    <span className="font-mono text-[11px] text-muted">{hint}</span>
  </button>
);

/** First run: a new phrase, a passkey, a phrase from elsewhere, or a hardware wallet. */
export const Onboard = ({ onBackup }: { onBackup: (b: BackupView) => void }) => {
  const [step, setStep] = useState<Step>('welcome');
  const back = () => setStep('welcome');
  if (step === 'create') return <Create onBack={back} onBackup={onBackup} />;
  if (step === 'passkey') return <Passkey onBack={back} onBackup={onBackup} />;
  if (step === 'restore') return <Restore onBack={back} />;
  if (step === 'hardware') return <Hardware onBack={back} />;
  return (
    <div className="flex min-h-[var(--app-h)] flex-col">
      <Header title="Pangolin" />
      <div className="flex flex-1 flex-col gap-2.5 px-[18px] pt-10">
        <Slug>Start</Slug>
        <Choice title="New wallet" hint="Recovery phrase" onClick={() => setStep('create')} />
        <Choice title="Passkey" hint="No phrase" onClick={() => setStep('passkey')} />
        <Choice title="Restore" hint="From a phrase" onClick={() => setStep('restore')} />
        <Choice title="Hardware wallet" hint="Bluetooth or USB" onClick={() => setStep('hardware')} />
      </div>
    </div>
  );
};

const Passwords = ({ label, busy, error, onSubmit }: { label: string; busy: boolean; error: string | null; onSubmit: (password: string) => void }) => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const submit = () => {
    setMismatch(password !== confirm);
    if (password === confirm) onSubmit(password);
  };
  return (
    <>
      <Field label="Password">
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Again">
        <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </Field>
      <ErrorLine>{mismatch ? 'Passwords differ' : error}</ErrorLine>
      <div className="flex-1" />
      <Button className="mb-[18px]" busy={busy} onClick={submit}>
        {label}
      </Button>
    </>
  );
};

const Create = ({ onBack, onBackup }: { onBack: () => void; onBackup: (b: BackupView) => void }) => {
  const a = useAction();
  return (
    <div className="flex min-h-[var(--app-h)] flex-col">
      <Header title="New wallet" onBack={onBack} />
      <div className="flex flex-1 flex-col gap-4 px-[18px] pt-6">
        <Passwords
          label="Create"
          busy={a.busy}
          error={a.error}
          onSubmit={(password) =>
            a.run(async () => {
              const { mnemonic } = await call('vault.create', { password });
              onBackup({ phrase: mnemonic, optional: false });
            })
          }
        />
      </div>
    </div>
  );
};

const Passkey = ({ onBack, onBackup }: { onBack: () => void; onBackup: (b: BackupView) => void }) => {
  const a = useAction();
  return (
    <div className="flex min-h-[var(--app-h)] flex-col">
      <Header title="Passkey" onBack={onBack} />
      <div className="flex flex-1 flex-col gap-3 px-[18px] pt-6">
        <p className="text-[15px] leading-snug">Your passkey is the wallet. Sync it, and it restores on any device.</p>
        <div className="flex-1" />
        <ErrorLine>{a.error}</ErrorLine>
        <Button
          busy={a.busy}
          onClick={() =>
            a.run(async () => {
              const pk = await createPasskey();
              const { mnemonic } = await call('vault.passkey', { ...pk, existing: false });
              onBackup({ phrase: mnemonic, optional: true });
            })
          }
        >
          Create passkey
        </Button>
        <Button
          variant="ghost"
          className="mb-[18px]"
          disabled={a.busy}
          onClick={() =>
            a.run(async () => {
              const pk = await getPasskey();
              await call('vault.passkey', { ...pk, existing: true });
            })
          }
        >
          Use existing passkey
        </Button>
      </div>
    </div>
  );
};

/** A hardware wallet: pick the device (Bluetooth or USB), then three approvals on it. */
const Hardware = ({ onBack }: { onBack: () => void }) => {
  const a = useAction();
  const connect = (link: HwLink) =>
    a.run(async () => {
      await chooseDevice(link);
      await call('vault.hardware', null);
    });
  return (
    <div className="flex min-h-[var(--app-h)] flex-col">
      <Header title="Hardware wallet" onBack={onBack} />
      <div className="flex flex-1 flex-col gap-3 px-[18px] pt-6">
        <p className="text-[15px] leading-snug">Keys stay on the device. Pangolin can see your private balance; only the device can spend it.</p>
        <div className="flex-1" />
        <ErrorLine>{a.error}</ErrorLine>
        <Button busy={a.busy} onClick={() => connect('ble')}>
          Connect with Bluetooth
        </Button>
        <Button variant="ghost" className="mb-[18px]" disabled={a.busy} onClick={() => connect('usb')}>
          Connect with USB
        </Button>
      </div>
    </div>
  );
};

const Restore = ({ onBack }: { onBack: () => void }) => {
  const [count, setCount] = useState<12 | 24>(12);
  const [words, setWords] = useState<string[]>(Array(24).fill(''));
  const a = useAction();
  const shown = words.slice(0, count);
  const bad = shown.map((w) => w !== '' && !isWord(w));
  const complete = shown.every((w) => w !== '') && !bad.some(Boolean);

  const set = (i: number, value: string) => {
    const parts = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    // A pasted phrase fills the grid from this box on.
    if (parts.length > 1) {
      if (i === 0 && parts.length > 12) setCount(24);
      setWords((w) => w.map((x, j) => (j >= i && j - i < parts.length ? parts[j - i] : x)));
      return;
    }
    setWords((w) => w.map((x, j) => (j === i ? value.trim().toLowerCase() : x)));
  };

  return (
    <div className="flex min-h-[var(--app-h)] flex-col">
      <Header
        title="Restore"
        onBack={onBack}
        right={
          <Button variant="link" className="text-muted" onClick={() => setCount(count === 12 ? 24 : 12)}>
            {count === 12 ? '24 words' : '12 words'}
          </Button>
        }
      />
      <div className="flex flex-1 flex-col gap-4 px-[18px] pt-2">
        <div className="grid grid-cols-3 gap-1.5">
          {shown.map((w, i) => (
            <label key={i} className={`flex items-center gap-1.5 rounded-sm border bg-sheet px-2 py-1.5 focus-within:border-accent ${bad[i] ? 'border-danger' : 'border-rule'}`}>
              <span className="w-4 text-right font-mono text-[10px] text-muted tnum">{i + 1}</span>
              <input
                aria-label={`Word ${i + 1}`}
                value={w}
                autoFocus={i === 0}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => set(i, e.target.value)}
                className="min-w-0 flex-1 bg-transparent font-mono text-[12px] outline-none"
              />
            </label>
          ))}
        </div>
        {complete && (
          <Passwords
            label="Restore"
            busy={a.busy}
            error={a.error}
            onSubmit={(password) => a.run(() => call('vault.import', { password, mnemonic: shown.join(' ') }))}
          />
        )}
      </div>
    </div>
  );
};

/** The phrase once, then three of its words back. A passkey wallet may skip: the passkey restores it. */
export const Backup = ({ phrase, optional, onDone }: BackupView & { onDone: () => void }) => {
  const words = phrase.split(' ');
  const [checking, setChecking] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [wrong, setWrong] = useState(false);
  const asked = useMemo(() => {
    const picks = new Set<number>();
    while (picks.size < 3) picks.add(crypto.getRandomValues(new Uint32Array(1))[0] % words.length);
    return [...picks].sort((x, y) => x - y);
  }, [words.length]);

  if (checking) {
    const check = () => {
      const ok = asked.every((i) => (answers[i] ?? '').trim().toLowerCase() === words[i]);
      setWrong(!ok);
      if (ok) onDone();
    };
    return (
      <div className="flex min-h-[var(--app-h)] flex-col">
        <Header title="Check" onBack={() => setChecking(false)} />
        <div className="flex flex-1 flex-col gap-4 px-[18px] pt-4">
          {asked.map((i, k) => (
            <Field key={i} label={`Word ${i + 1}`}>
              <Input
                aria-label={`Word ${i + 1}`}
                autoFocus={k === 0}
                autoComplete="off"
                spellCheck={false}
                value={answers[i] ?? ''}
                onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && check()}
              />
            </Field>
          ))}
          <ErrorLine>{wrong ? "Doesn't match" : null}</ErrorLine>
          <div className="flex-1" />
          <Button className="mb-[18px]" onClick={check}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[var(--app-h)] flex-col">
      <Header title="Recovery phrase" />
      <div className="flex flex-1 flex-col gap-4 px-[18px] pt-4">
        <Card edge className="p-4">
          <ol className="grid grid-cols-3 gap-x-3 gap-y-2.5 font-mono text-[13px]">
            {words.map((w, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="w-4 text-right text-muted tnum">{i + 1}</span>
                {w}
              </li>
            ))}
          </ol>
        </Card>
        <Slug className="text-warn">{optional ? 'Optional. Your passkey restores this wallet.' : 'Write it down. Shown once.'}</Slug>
        <div className="flex-1" />
        <Button className={optional ? '' : 'mb-[18px]'} onClick={() => setChecking(true)}>
          Saved it
        </Button>
        {optional && (
          <Button variant="link" className="mb-[18px] self-center text-muted" onClick={onDone}>
            Skip
          </Button>
        )}
      </div>
    </div>
  );
};

/** The onboarding tab, once the wallet exists. */
export const Ready = () => (
  <div className="flex min-h-[var(--app-h)] flex-col">
    <Header title="Pangolin" />
    <div className="flex flex-1 flex-col items-center gap-4 px-[18px] pt-24 text-center">
      <span className="stamp">Ready</span>
      <p className="text-[15px]">Open Pangolin from the toolbar.</p>
    </div>
  </div>
);
