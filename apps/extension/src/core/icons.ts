// Dapp icons named in WalletConnect metadata. The URL is chosen by the dapp,
// so loading it straight from the popup would tell that host this browser's IP.
// Instead the core fetches it once through the transport (Nox when on) and
// hands the UI an inline data: URL. Only https: and data: images, capped size.
import { privateFetch } from './transport';

const cache = new Map<string, string | null>();
const MAX_BYTES = 256_000;

const b64 = (u: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * The icon as a data: URL if already fetched, else null. A first call starts
 * the fetch and calls `onReady` once it lands, so the caller can re-render.
 */
export const iconFor = (url: string | null | undefined, onReady: () => void): string | null => {
  if (!url) return null;
  if (cache.has(url)) return cache.get(url) ?? null;
  cache.set(url, null);
  void (async () => {
    try {
      const u = new URL(url);
      if (u.protocol === 'data:') {
        if (/^data:image\//i.test(url) && url.length <= MAX_BYTES * 1.4) cache.set(url, url);
      } else if (u.protocol === 'https:') {
        const res = await privateFetch(url);
        const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
        if (!res.ok || !type.startsWith('image/')) return;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length === 0 || bytes.length > MAX_BYTES) return;
        cache.set(url, `data:${type};base64,${b64(bytes)}`);
      }
      if (cache.get(url)) onReady();
    } catch {
      // A missing icon is cosmetic: the UI falls back to initials.
    }
  })();
  return null;
};
