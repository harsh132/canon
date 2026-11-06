// The sponsor's HTTP API, shared by the local Bun server (server.ts) and the
// Cloudflare Worker (worker.ts). Three jobs, one key:
//  /claim   issues <label>.pangolin.eth to a user's unfunded identity address,
//           with an org.railgun record pointing at their 0zk; then hands every
//           role on the name and its resolver to the user
//  /relay   submits proved RAILGUN transactions so users' addresses never pay gas (relay.ts)
//  /execute submits Calibur calls for EIP-7702 site addresses, delegating on first use (execute.ts)
//
// What this server learns is exactly what goes on-chain: label, identity
// address, 0zk address, calls. The extension calls it through Nox when it can.
import { dnsEncode, id, isAddress } from 'ethers';
import { A, FOREVER, RESOLVER_ALL, TEXT_KEY, USER_ROLES, ZERO, connect, resolverIface } from './ens';
import { RelayError, relay } from './relay';
import { execute } from './execute';

export type AppConfig = {
  key: string;
  rpc?: string;
  parent?: string;
  subregistry: string;
  /** Per-hour caps; lower on a public deployment. */
  caps?: { claim?: number; relay?: number; execute?: number };
};

export const makeApp = (cfg: AppConfig) => {
const PARENT = cfg.parent ?? 'pangolin';
const subregistry = cfg.subregistry;
const caps = { claim: 20, relay: 60, execute: 60, ...cfg.caps };
const { sponsor, factory, userRegistryAt, resolverAt } = connect(cfg.key, cfg.rpc);
const registry = userRegistryAt(subregistry);
const claimed: number[] = [];

const LABEL = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;
const ZK = /^0zk1[0-9a-z]{100,140}$/;

// One transaction sequence at a time: the sponsor has one nonce.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
};

const isFree = async (label: string) => ((await registry.findOwner(label)) as string) === ZERO;

const claim = async (label: string, owner: string, zk: string) => {
  if (!(await isFree(label))) throw Object.assign(new Error('Name taken'), { status: 409 });
  const name = `${label}.${PARENT}.eth`;
  const salt = BigInt(id(`resolver:${name}`));
  const resolverAddr = (await factory.predictProxyAddress(sponsor.address, salt)) as string;
  const txs: string[] = [];
  const run = async (tx: Promise<{ hash: string; wait: () => Promise<{ status: number } | null> }>) => {
    const sent = await tx;
    txs.push(sent.hash);
    const r = await sent.wait();
    if (r?.status !== 1) throw new Error(`tx ${sent.hash} failed`);
  };
  // The user's own resolver, sponsor as temporary admin.
  if ((await sponsor.provider!.getCode(resolverAddr)) === '0x') {
    await run(factory.deployProxy(A.RESOLVER_IMPL, salt, resolverIface.encodeFunctionData('initialize', [[[sponsor.address, RESOLVER_ALL]], []])));
  }
  // Write the record, hand every role to the user, drop ours. One transaction.
  await run(
    resolverAt(resolverAddr).multicall([
      resolverIface.encodeFunctionData('setText', [dnsEncode(name), TEXT_KEY, zk]),
      resolverIface.encodeFunctionData('grantRootRoles', [RESOLVER_ALL, owner]),
      resolverIface.encodeFunctionData('revokeRootRoles', [RESOLVER_ALL, sponsor.address]),
    ]),
  );
  // The name itself: owned by the user, never expires.
  await run(registry.register(label, owner, ZERO, resolverAddr, USER_ROLES, FOREVER));
  return { name, owner, resolver: resolverAddr, txs };
};

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

const fetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    try {
      if (url.pathname === '/health') return json({ parent: `${PARENT}.eth`, subregistry, sponsor: sponsor.address });
      if (url.pathname === '/available') {
        const label = url.searchParams.get('label') ?? '';
        if (!LABEL.test(label)) return json({ error: 'Use 3–32 of a-z, 0-9, -' }, 400);
        return json({ label, available: await isFree(label) });
      }
      if (url.pathname === '/claim' && req.method === 'POST') {
        const { label, owner, zk } = (await req.json()) as { label?: string; owner?: string; zk?: string };
        if (!label || !LABEL.test(label)) return json({ error: 'Use 3–32 of a-z, 0-9, -' }, 400);
        if (!owner || !isAddress(owner)) return json({ error: 'Bad owner address' }, 400);
        if (!zk || !ZK.test(zk)) return json({ error: 'Bad 0zk address' }, 400);
        const now = Date.now();
        while (claimed.length && claimed[0] < now - 3_600_000) claimed.shift();
        if (claimed.length >= caps.claim) return json({ error: 'Busy; try later' }, 429);
        claimed.push(now);
        const out = await serial(() => claim(label, owner, zk));
        console.log('[sponsor] issued', out.name, '->', owner);
        return json(out);
      }
      if (url.pathname === '/relay' && req.method === 'POST') {
        const body = (await req.json()) as Parameters<typeof relay>[1];
        const out = await serial(() => relay(sponsor, body, caps.relay));
        console.log('[sponsor] relayed', out.hash);
        return json(out);
      }
      if (url.pathname === '/execute' && req.method === 'POST') {
        const body = (await req.json()) as Parameters<typeof execute>[1];
        const out = await serial(() => execute(sponsor, body, caps.execute));
        console.log('[sponsor] executed for', body.account, out.delegated ? '' : '(with 7702 authorization)', out.hash);
        return json(out);
      }
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      const status = e instanceof RelayError ? e.status : ((e as { status?: number }).status ?? 500);
      console.error('[sponsor]', (e as Error).message);
      return json({ error: (e as Error).message.slice(0, 200) }, status);
    }
};

return { fetch, sponsor, subregistry, parent: PARENT };
};
