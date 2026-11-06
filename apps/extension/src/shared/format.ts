import { formatUnits } from 'ethers';

export const short = (a: string, head = 6, tail = 4): string =>
  a.length <= head + tail + 1 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`;

export const amount = (v: bigint | null | undefined, decimals = 18, digits = 4): string => {
  if (v == null) return '—';
  const [i, f = ''] = formatUnits(v, decimals).split('.');
  const frac = f.slice(0, digits).padEnd(digits, '0');
  return `${i}.${frac}`;
};

export const isZk = (s: string): boolean => /^0zk[0-9a-z]{20,}$/i.test(s.trim());
export const isHexAddress = (s: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(s.trim());
