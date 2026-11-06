// Two jobs, one key:
//  /claim  issues <label>.pangolin.eth (below)
//  /relay  submits proved RAILGUN transactions so users' addresses never pay gas (relay.ts)
//
// Issues <label>.pangolin.eth to a user's unfunded identity address, with an
// org.railgun record pointing at their 0zk. The sponsor pays all gas, then
// hands every role on the name and its resolver to the user.
//
// What this server learns is exactly what goes on-chain: label, identity
// address, 0zk address. The extension calls it through Nox when it can.
//   bun src/server.ts
import { readFileSync } from 'node:fs';
import { dnsEncode, id, isAddress } from 'ethers';
import { A, FOREVER, RESOLVER_ALL, TEXT_KEY, USER_ROLES, ZERO, connect, resolverIface } from './ens';
import { RelayError, relay } from './relay';

const PARENT = process.env.PARENT_LABEL ?? 'pangolin';
const PORT = Number(process.env.PORT ?? 8792);
const { subregistry } = JSON.parse(readFileSync(new URL('../.data/parent.json', import.meta.url).pathname, 'utf8'));
const { sponsor, factory, userRegistryAt, resolverAt } = connect();
const registry = userRegistryAt(subregistry);

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

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
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
        const out = await serial(() => claim(label, owner, zk));
        console.log('[sponsor] issued', out.name, '->', owner);
        return json(out);
      }
      if (url.pathname === '/relay' && req.method === 'POST') {
        const body = (await req.json()) as Parameters<typeof relay>[1];
        const out = await serial(() => relay(sponsor, body));
        console.log('[sponsor] relayed', out.hash);
        return json(out);
      }
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      const status = e instanceof RelayError ? e.status : ((e as { status?: number }).status ?? 500);
      console.error('[sponsor]', (e as Error).message);
      return json({ error: (e as Error).message.slice(0, 200) }, status);
    }
  },
});
console.log(`[sponsor] ${PARENT}.eth subregistry ${subregistry}; sponsor ${sponsor.address}; http://127.0.0.1:${PORT}`);
