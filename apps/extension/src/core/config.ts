import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { JsonRpcProvider } from 'ethers';

export const WC_PROJECT_ID = process.env.CANON_WC_PROJECT_ID ?? '';
export const DEV = process.env.NODE_ENV !== 'production';
export const FORK = process.env.CANON_FORK === '1';
export const AUTO_LOCK_MS = 15 * 60_000;
export const POI_NODES = ['https://ppoi.fdi.network'];

// --- Public networks: shared/networks.ts -------------------------------------
import { NETS, SEPOLIA_ID, ARBITRUM_ID, netOf, hexChain } from '../shared/networks';
export { NETS, SEPOLIA_ID, ARBITRUM_ID, netOf, hexChain };
export type { Net, Token } from '../shared/networks';

const providers = new Map<number, JsonRpcProvider>();
/** One provider per network. The transport hook (transport.ts) sends their requests through Nox. */
export const providerFor = (chainId: number): JsonRpcProvider => {
  const net = netOf(chainId);
  if (!net) throw new Error(`Unsupported network ${chainId}`);
  let p = providers.get(chainId);
  if (!p) providers.set(chainId, (p = new JsonRpcProvider(net.rpc, chainId, { staticNetwork: true, batchMaxCount: 1 })));
  return p;
};

// --- Private network ----------------------------------------------------------
// RAILGUN runs on one network at a time: Sepolia (testnet, sponsored) or
// Arbitrum. Chosen when the core starts; switching reloads the core, which locks
// the wallet. Not secret, so it lives in localStorage, which is synchronous.

export type PrivateNet = 'sepolia' | 'arbitrum';
export const PRIVATE_NET_KEY = 'canon.privateNet';
const chosen = (): PrivateNet => {
  try {
    return globalThis.localStorage?.getItem(PRIVATE_NET_KEY) === 'arbitrum' ? 'arbitrum' : 'sepolia';
  } catch {
    return 'sepolia';
  }
};
export const PRIVATE: PrivateNet = FORK ? 'sepolia' : chosen();
export const NETWORK = PRIVATE === 'arbitrum' ? NetworkName.Arbitrum : NetworkName.EthereumSepolia;
export const CHAIN = NETWORK_CONFIG[NETWORK].chain;
/** The private network's chain id. Public features use a site's own chain instead. */
export const CHAIN_ID = CHAIN.id;
export const WETH = NETWORK_CONFIG[NETWORK].baseToken.wrappedAddress;
export const RPC_URL = netOf(CHAIN_ID)!.rpc;
/** Transactions are built only on Sepolia for now; Arbitrum's private balance is view-only. */
export const PRIVATE_TX = PRIVATE === 'sepolia';

/** The private network's provider (RAILGUN, sends, swaps, Fund). */
export const getProvider = (): JsonRpcProvider => providerFor(CHAIN_ID);
/** Sepolia only: names, the sponsor, Calibur sponsorship. */
export const sepolia = (): JsonRpcProvider => providerFor(SEPOLIA_ID);
