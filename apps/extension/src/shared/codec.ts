// chrome.runtime messaging is JSON. Bigints travel tagged.
const TAG = '$bigint';

export const encode = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? { [TAG]: v.toString() } : v));

export const decode = <T = unknown>(text: string): T =>
  JSON.parse(text, (_k, v: unknown) =>
    v !== null && typeof v === 'object' && TAG in v ? BigInt((v as Record<string, string>)[TAG]) : v,
  ) as T;
