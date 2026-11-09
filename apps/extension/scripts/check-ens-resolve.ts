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

rpc = 'http://127.0.0.1:9';
await assert.rejects(resolveName('alice.pangolin.eth'), (e: Error) => !/has no address|is not registered/.test(e.message));

console.log('pass  ens-resolve');
process.exit(0);
