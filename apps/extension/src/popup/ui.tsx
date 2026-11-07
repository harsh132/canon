import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { explorerTx } from '../shared/networks';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export const Slug = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cx('slug', className)}>{children}</span>
);

export const Card = ({ children, edge, className }: { children: ReactNode; edge?: boolean; className?: string }) => (
  <div className={cx('rounded-md border border-rule bg-sheet shadow-lift', edge && 'tape-edge pb-6', className)}>{children}</div>
);

export const Row = ({ label, children, last }: { label: ReactNode; children: ReactNode; last?: boolean }) => (
  <div className={cx('flex items-baseline justify-between gap-4 py-2.5 text-[13px]', !last && 'rule-dash')}>
    <Slug className="flex-none">{label}</Slug>
    <span className="min-w-0 truncate text-right font-mono text-xs tnum">{children}</span>
  </div>
);

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'link'; busy?: boolean };
export const Button = ({ variant = 'primary', busy, className, children, disabled, ...rest }: BtnProps) => (
  <button
    {...rest}
    disabled={disabled || busy}
    className={cx(
      'inline-flex items-center justify-center gap-2 rounded-sm font-mono text-xs font-bold tracking-[0.1em] uppercase transition-colors disabled:opacity-50',
      variant === 'primary' && 'bg-accent px-4 py-3 text-on-accent hover:bg-accent-strong',
      variant === 'ghost' && 'border border-rule-strong px-4 py-3 text-ink hover:border-ink',
      variant === 'link' && 'p-0 text-[11px] tracking-[0.12em] text-accent',
      className,
    )}
  >
    {busy ? '…' : children}
  </button>
);

export const Input = ({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...rest}
    className={cx(
      'w-full rounded-sm border border-rule bg-sheet px-3.5 py-2.5 font-mono text-sm text-ink outline-none placeholder:text-muted/70 focus:border-accent',
      className,
    )}
  />
);

export const Field = ({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) => (
  <label className="block">
    <span className="mb-2 flex items-baseline justify-between">
      <Slug>{label}</Slug>
      {hint && <span className="font-mono text-[11px] text-muted">{hint}</span>}
    </span>
    {children}
  </label>
);

export const ErrorLine = ({ children }: { children: ReactNode }) =>
  children ? <p className="font-mono text-[11px] text-danger">{children}</p> : null;

export const Mark = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2.5l8 4.5v10l-8 4.5-8-4.5v-10z" />
    <path d="M12 7l4.5 2.5v5L12 17l-4.5-2.5v-5z" />
  </svg>
);

export const Header = ({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) => (
  <div className="flex items-center justify-between px-[18px] pt-4 pb-3">
    {onBack ? (
      <button onClick={onBack} className="inline-flex items-center gap-2 text-ink">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        <span className="font-mono text-[11px] font-bold tracking-[0.18em] uppercase">{title}</span>
      </button>
    ) : (
      <div className="flex items-center gap-2">
        <Mark />
        <span className="font-mono text-[11px] font-bold tracking-[0.18em] uppercase">{title}</span>
      </div>
    )}
    {right}
  </div>
);

/** A tab screen's context line (the tab bar already names the screen). */
export const Meta = ({ children }: { children: ReactNode }) => <div className="flex justify-end px-[18px] pt-3 pb-1">{children}</div>;

export const Copy = ({ value, label = 'Copy' }: { value: string; label?: string }) => (
  <Button variant="link" onClick={() => void navigator.clipboard.writeText(value)}>
    {label}
  </Button>
);

/** A transaction on its network's explorer (Sepolia when no network is given). */
export const etherscan = (hash: string, chainId?: number) => explorerTx(hash, chainId);

/**
 * Chrome's cached favicon for a site the user has open or visited. Served by
 * the browser from its own cache: no network request from Canon.
 */
export const faviconFor = (origin: string | null | undefined): string | null => {
  if (!origin) return null;
  const page = /^[a-z]+:\/\//.test(origin) ? origin : `https://${origin}`;
  return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(page)}&size=64`);
};

/**
 * A dapp's icon with an initials fallback that never leaves a hole. `src` is a
 * data: URL from the core or a favicon URL from faviconFor; nothing else.
 */
export const AppIcon = ({ name, src, size = 28 }: { name: string; src: string | null; size?: number }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const style = { width: size, height: size };
  if (!src || failed) {
    const initials =
      name
        .replace(/^[a-z]+:\/\//, '')
        .split(/[\s.]+/)
        .filter(Boolean)
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase() || '?';
    return (
      <span style={style} aria-hidden="true" className="grid flex-none place-items-center rounded-sm border border-rule bg-sheet font-mono text-[10px] text-muted">
        {initials}
      </span>
    );
  }
  return <img src={src} alt="" style={style} onError={() => setFailed(true)} className="flex-none rounded-sm border border-rule bg-sheet object-contain p-0.5" />;
};
