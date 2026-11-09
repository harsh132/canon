// Name lookup errors (src/core/ens.ts resolveName), against live Sepolia ENSv2 through
// publicnode (no Nox, no browser): a name that exists resolves, a missing one says
// "is not registered", and a dead RPC reports itself instead of "has no address".
//   bun scripts/check-ens-resolve.ts
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { JsonRpcProvider } from 'ethers';

let rpc = 'https://ethereum-sepolia-rpc.publicnode.com';
mock.module('../src/core/config', () => ({ SPONSOR_URL: '', sepolia: () => new JsonRpcProvider(rpc, 11155111, { staticNetwork: true }) }));
const no = () => { throw new Error('not used'); };
mock.module('../src/core/book', () => ({ createAccount: no, previewAccount: no, setName: no, signerFor: no, accounts: () => [] }));
mock.module('../src/core/transport', () => ({ privateFetch: no, replyJson: no }));
mock.module('../src/core/state', () => ({ state: {}, emit: () => {} }));

const { resolveName } = await import('../src/core/ens');

const alice = await resolveName('alice.pangolin.eth');
assert.equal(alice.via, 'org.railgun');
assert.match(alice.address, /^0zk/);

await assert.rejects(resolveName('nobody-canon-check.canon.eth'), /is not registered/);

const notMissing = (e: Error) => !/has no address|is not registered/.test(e.message);
rpc = 'http://127.0.0.1:9';
await assert.rejects(resolveName('alice.pangolin.eth'), notMissing);

// An RPC error reply (ethers labels it CALL_EXCEPTION too, with no revert data): reported,
// never read as a missing record. The text lookup fails, the addr lookup would succeed.
let calls = 0;
const fake = Bun.serve({
  port: 0,
  fetch: async (req) => {
    const { id } = (await req.json()) as { id: number };
    calls += 1;
    if (calls === 1) return Response.json({ jsonrpc: '2.0', id, error: { code: -32000, message: 'upstream request timed out' } });
    return Response.json({ jsonrpc: '2.0', id, result: '0x' });
  },
});
rpc = `http://127.0.0.1:${fake.port}`;
await assert.rejects(resolveName('alice.pangolin.eth'), (e: Error) => notMissing(e) && /timed out/.test(e.message));
assert.equal(calls, 1, 'no fall-through to the addr lookup');
fake.stop();

console.log('pass  ens-resolve');
process.exit(0);
