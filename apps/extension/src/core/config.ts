import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { JsonRpcProvider } from 'ethers';

export const NETWORK = NetworkName.EthereumSepolia;
export const CHAIN = NETWORK_CONFIG[NETWORK].chain;
export const CHAIN_ID = 11155111;
export const CAIP_CHAIN = `eip155:${CHAIN_ID}`;
export const WETH = NETWORK_CONFIG[NETWORK].baseToken.wrappedAddress;
export const RPC_URL = process.env.PANGOLIN_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';
export const POI_NODES = ['https://ppoi.fdi.network'];
export const WC_PROJECT_ID = process.env.PANGOLIN_WC_PROJECT_ID ?? '';
export const DEV = process.env.NODE_ENV !== 'production';
export const FORK = process.env.PANGOLIN_FORK === '1';
export const AUTO_LOCK_MS = 15 * 60_000;

// The one place RPC transport is chosen. Anon-RPC slots in here next.
let provider: JsonRpcProvider | null = null;
export const getProvider = (): JsonRpcProvider =>
  (provider ??= new JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true, batchMaxCount: 1 }));
