// Transaction preview for dapp requests. Before the user approves, the calls are
// simulated with eth_simulateV1 (traceTransfers: native ETH moves show up as
// Transfer logs), through the same provider as every other read, so through Nox.
// The preview is advice only: approval still signs the dapp's original request.
import { Contract, Interface, formatUnits, getAddress, id, type JsonRpcProvider } from 'ethers';
import type { TxPreview } from '../shared/protocol';
import { netOf } from '../shared/networks';
import { short } from '../shared/format';

export type PreviewCall = { to?: string; value?: string; data?: string };

const TRANSFER = id('Transfer(address,address,uint256)');
const APPROVAL = id('Approval(address,address,uint256)');
const APPROVAL_FOR_ALL = id('ApprovalForAll(address,address,bool)');
// WETH9 mints and burns with its own events, not Transfer.
const DEPOSIT = id('Deposit(address,uint256)');
const WITHDRAWAL = id('Withdrawal(address,uint256)');
// Where nodes put the synthetic logs for native ETH moves: older geth and other
// clients use 0xeeee…, newer geth (EIP-7708) uses 0xffff…fffe.
const NATIVE_LOG = new Set(['0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', '0xfffffffffffffffffffffffffffffffffffffffe']);
// At or above this, an allowance is "unlimited" in practice (dapps send 2^256-1 or 2^160-1).
const UNLIMITED = 2n ** 128n;

const known = new Interface([
  'function transfer(address to, uint256 amount)',
  'function approve(address spender, uint256 amount)',
  'function transferFrom(address from, address to, uint256 amount)',
  'function increaseAllowance(address spender, uint256 amount)',
  'function setApprovalForAll(address operator, bool approved)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function deposit()',
  'function withdraw(uint256 amount)',
]);

/** The calls a request would make, or null for requests that are not transactions. */
export const callsOf = (method: string, params: unknown[]): PreviewCall[] | null => {
  if (method === 'eth_sendTransaction') return [(params?.[0] ?? {}) as PreviewCall];
  if (method === 'wallet_sendCalls') return ((params?.[0] ?? {}) as { calls?: PreviewCall[] }).calls ?? [];
  return null;
};

type TokenInfo = { symbol: string; decimals: number | null };
const tokenCache = new Map<string, TokenInfo>();
const tokenInfo = async (provider: JsonRpcProvider, chainId: number, address: string): Promise<TokenInfo> => {
  if (NATIVE_LOG.has(address)) return { symbol: netOf(chainId)?.native ?? 'ETH', decimals: 18 };
  const k = `${chainId}:${address}`;
  const hit = tokenCache.get(k);
  if (hit) return hit;
  const listed = netOf(chainId)?.tokens.find((t) => t.address.toLowerCase() === address);
  let info: TokenInfo;
  if (listed) info = { symbol: listed.symbol, decimals: listed.decimals };
  else {
    const c = new Contract(address, ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'], provider);
    const [symbol, decimals] = await Promise.all([
      (c.symbol() as Promise<string>).catch(() => short(getAddress(address))),
      (c.decimals() as Promise<bigint>).then(Number).catch(() => null),
    ]);
    info = { symbol: String(symbol).slice(0, 16), decimals };
  }
  tokenCache.set(k, info);
  return info;
};

const fmt = (v: bigint, t: TokenInfo): string => {
  const abs = v < 0n ? -v : v;
  const n = t.decimals == null ? abs.toString() : formatUnits(abs, t.decimals).replace(/(\.\d{6})\d+$/, '$1').replace(/\.0$/, '');
  return `${n} ${t.symbol}`;
};

const topicAddress = (topic: string): string => `0x${topic.slice(26)}`.toLowerCase();

/** One line per call, in words, from the calldata alone. */
const describe = async (provider: JsonRpcProvider, chainId: number, c: PreviewCall): Promise<string> => {
  const to = (c.to ?? '').toLowerCase();
  const value = BigInt(c.value ?? 0);
  const native: TokenInfo = { symbol: netOf(chainId)?.native ?? 'ETH', decimals: 18 };
  if (!to) return 'Create a contract';
  const data = c.data ?? '0x';
  if (data === '0x' || data === '') return `Send ${fmt(value, native)} to ${short(getAddress(to))}`;
  const parsed = (() => {
    try {
      return known.parseTransaction({ data, value });
    } catch {
      return null;
    }
  })();
  const plus = value > 0n ? ` with ${fmt(value, native)}` : '';
  if (!parsed) return `Call ${data.slice(0, 10)} on ${short(getAddress(to))}${plus}`;
  const t = await tokenInfo(provider, chainId, to);
  const a = parsed.args;
  switch (parsed.name) {
    case 'transfer':
      return `Transfer ${fmt(a[1], t)} to ${short(a[0])}`;
    case 'transferFrom':
    case 'safeTransferFrom':
      return parsed.name === 'safeTransferFrom' || t.decimals == null
        ? `Move ${t.symbol} #${a[2]} from ${short(a[0])} to ${short(a[1])}`
        : `Move ${fmt(a[2], t)} from ${short(a[0])} to ${short(a[1])}`;
    case 'approve':
    case 'increaseAllowance':
      return `Allow ${short(a[0])} to spend ${a[1] >= UNLIMITED ? `unlimited ${t.symbol}` : fmt(a[1], t)}`;
    case 'setApprovalForAll':
      return a[1] ? `Allow ${short(a[0])} to move all your ${t.symbol}` : `Remove ${short(a[0])}'s access to your ${t.symbol}`;
    case 'deposit':
      return `Wrap ${fmt(value, native)} into ${t.symbol}`;
    case 'withdraw':
      return `Unwrap ${fmt(a[0], t)}`;
  }
  return `Call ${parsed.name} on ${short(getAddress(to))}${plus}`;
};

type SimCall = { status: string; logs?: { address: string; topics: string[]; data: string }[]; error?: { message?: string } };

/** Simulates the calls in order, as `from`, and reads what they change for `from`. */
export const simulate = async (provider: JsonRpcProvider, chainId: number, from: string, calls: PreviewCall[]): Promise<Extract<TxPreview, { status: 'done' }>> => {
  const me = from.toLowerCase();
  const lines = await Promise.all(calls.map((c) => describe(provider, chainId, c).catch(() => `Call on ${c.to ?? '?'}`)));
  const warnings: { text: string; danger: boolean }[] = [];
  let result: { calls: SimCall[] }[];
  try {
    result = await provider.send('eth_simulateV1', [
      {
        blockStateCalls: [{ calls: calls.map((c) => ({ from, to: c.to, value: c.value ?? '0x0', data: c.data ?? '0x' })) }],
        traceTransfers: true,
        validation: false,
      },
      'latest',
    ]);
  } catch (e) {
    return { status: 'done', simulated: false, ok: null, calls: lines, changes: [], warnings: [{ text: `Could not simulate: ${(e as Error).message.slice(0, 120)}`, danger: false }] };
  }
  const sims = result?.[0]?.calls ?? [];
  const failed = sims.find((s) => s.status !== '0x1');
  const net = new Map<string, bigint>();
  const nfts: { token: string; id: bigint; in: boolean }[] = [];
  for (const s of failed ? [] : sims) {
    for (const log of s.logs ?? []) {
      const token = log.address.toLowerCase();
      const [topic, a, b, c] = log.topics;
      if (topic === TRANSFER && log.topics.length === 3) {
        const v = BigInt(log.data);
        const src = topicAddress(a);
        const dst = topicAddress(b);
        if (src === me) net.set(token, (net.get(token) ?? 0n) - v);
        if (dst === me) net.set(token, (net.get(token) ?? 0n) + v);
      } else if ((topic === DEPOSIT || topic === WITHDRAWAL) && log.topics.length === 2 && topicAddress(a) === me) {
        const v = BigInt(log.data);
        net.set(token, (net.get(token) ?? 0n) + (topic === DEPOSIT ? v : -v));
      } else if (topic === TRANSFER && log.topics.length === 4) {
        if (topicAddress(a) === me) nfts.push({ token, id: BigInt(c), in: false });
        if (topicAddress(b) === me) nfts.push({ token, id: BigInt(c), in: true });
      } else if (topic === APPROVAL && log.topics.length === 3 && topicAddress(a) === me) {
        const v = BigInt(log.data);
        if (v >= UNLIMITED) warnings.push({ text: `Unlimited ${(await tokenInfo(provider, chainId, token)).symbol} allowance to ${short(getAddress(topicAddress(b)))}`, danger: true });
      } else if (topic === APPROVAL_FOR_ALL && topicAddress(a) === me && BigInt(log.data) !== 0n) {
        warnings.push({ text: `${short(getAddress(topicAddress(b)))} can move all your ${(await tokenInfo(provider, chainId, token)).symbol}`, danger: true });
      }
    }
  }
  const changes: { text: string; in: boolean }[] = [];
  for (const [token, v] of net) {
    if (v === 0n) continue;
    changes.push({ text: `${v > 0n ? '+' : '−'}${fmt(v, await tokenInfo(provider, chainId, token))}`, in: v > 0n });
  }
  for (const n of nfts) changes.push({ text: `${n.in ? '+' : '−'}${(await tokenInfo(provider, chainId, n.token)).symbol} #${n.id}`, in: n.in });
  if (failed) warnings.unshift({ text: `Would fail${failed.error?.message ? `: ${failed.error.message.slice(0, 160)}` : ''}`, danger: true });
  return { status: 'done', simulated: true, ok: !failed, calls: lines, changes, warnings };
};

// One preview per prompt, keyed by the caller ('b:<id>' browser, 'w:<id>' WalletConnect).
// ponytail: keeps the last 50 previews; prompts are few, no eviction by age.
const cache = new Map<string, TxPreview>();

/** The preview for a prompt: 'pending' at first; `done` is called when the simulation finishes. */
export const previewFor = (key: string, provider: JsonRpcProvider, chainId: number, from: string, calls: PreviewCall[], done: () => void): TxPreview => {
  const hit = cache.get(key);
  if (hit) return hit;
  const pending: TxPreview = { status: 'pending' };
  cache.set(key, pending);
  if (cache.size > 50) cache.delete(cache.keys().next().value!);
  void simulate(provider, chainId, from, calls)
    .catch((e): TxPreview => ({ status: 'done', simulated: false, ok: null, calls: [], changes: [], warnings: [{ text: `Could not simulate: ${(e as Error).message}`, danger: false }] }))
    .then((p) => {
      cache.set(key, p);
      done();
    });
  return pending;
};
