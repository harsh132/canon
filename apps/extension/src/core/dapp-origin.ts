// A dapp's identity is its full host (plus port, plus CID on IPFS path
// gateways). Split by default, merge nothing: merging two sites hands them a
// shared address; splitting one only costs a duplicate. Ported from Ender.

const CONTENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{3,127}$/;

export const dappKeyFor = (url: string | undefined | null): string | null => {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const scheme = u.protocol.replace(':', '').toLowerCase();
  if (scheme === 'ipfs' || scheme === 'ipns') {
    const id = u.hostname || u.pathname.replace(/^\/*/, '').split('/')[0] || '';
    return id ? `${scheme}://${id}` : null;
  }
  const host = u.hostname.toLowerCase();
  if (!host) return null;
  const defaultPort = (scheme === 'https' && u.port === '443') || (scheme === 'http' && u.port === '80');
  const port = u.port && !defaultPort ? `:${u.port}` : '';
  const base = `${scheme === 'https' ? '' : `${scheme}://`}${host}${port}`;
  const [first, second] = u.pathname.split('/').filter(Boolean);
  if ((first === 'ipfs' || first === 'ipns') && second && CONTENT_ID.test(second)) return `${base}/${first}/${second}`;
  return base;
};
