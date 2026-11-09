// Checks the transport hook's retry when a node is behind the head block
// (src/core/transport.ts getUrl). A fake fetch answers eth_getLogs; no network.
//   bun scripts/check-head-lag.ts
import { FetchRequest, JsonRpcProvider } from 'ethers';

const LAG = { code: -32602, message: 'block range extends beyond current head block: requested 12093261, head 12093260' };
let calls = 0;
let lagFor = 0;
let error: object = LAG;
// transport.ts takes this as its untouched fetch when it loads.
(globalThis as { __canonRealFetch?: typeof fetch }).__canonRealFetch = async (_url, init) => {
  calls += 1;
  const { id } = JSON.parse(new TextDecoder().decode(init!.body as Uint8Array));
  const reply = calls <= lagFor ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result: [] };
  return new Response(JSON.stringify(reply), { headers: { 'content-type': 'application/json' } });
};
const { getUrl } = await import('../src/core/transport');
const { state } = await import('../src/core/state');
state.rpc.mode = 'direct';
FetchRequest.registerGetUrl(getUrl as never);
const p = new JsonRpcProvider('https://rpc.invalid', 11155111, { staticNetwork: true, batchMaxCount: 1 });
const getLogs = () => p.send('eth_getLogs', [{ fromBlock: '0xb8874c', toBlock: '0xb8874d' }]).then(() => 'ok', (e: Error) => e.message);

let fails = 0;
const check = async (name: string, lag: number, err: object, want: (got: string) => boolean, wantCalls: number) => {
  calls = 0;
  lagFor = lag;
  error = err;
  const got = await getLogs();
  const ok = want(got) && calls === wantCalls;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok ? '' : `\n      ${got}, ${calls} calls`}`);
  if (!ok) fails += 1;
};

await check('no lag: one call', 0, LAG, (g) => g === 'ok', 1);
await check('lags twice: retried, then ok', 2, LAG, (g) => g === 'ok', 3);
await check('other -32602: not retried', 9, { code: -32602, message: 'invalid argument' }, (g) => g !== 'ok', 1);
await check('lags for good: gives up after 5 retries', 99, LAG, (g) => /beyond current head/.test(g), 6);

p.destroy();
process.exit(fails ? 1 : 0);
