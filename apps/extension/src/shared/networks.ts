// Networks Canon supports, shared by the core and the UI. Plain data, no dependencies.

// Main and every site address are plain EVM addresses (site addresses use chain 0
// in their path), so the same address works on each of these. Each site picks
// its own network; reads and transactions go to that network, through Nox.

/** `warning`: set on a custom token whose symbol copies a known one (see checkToken). */
export type Token = { symbol: string; address: string; decimals: number; warning?: string };
export type Net = { chainId: number; name: string; native: string; rpc: string; explorer: string; tokens: Token[]; testnet?: boolean };

export const SEPOLIA_ID = 11155111;
export const ARBITRUM_ID = 42161;
const SEPOLIA_RPC = process.env.CANON_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';
const t = (symbol: string, address: string, decimals: number): Token => ({ symbol, address, decimals });

// Token addresses checked on-chain (symbol, decimals) on 2026-11-07.
// Arbitrum uses Offchain Labs' RPC: publicnode refuses RAILGUN's eth_getLogs there
// ("archive requests require a personal token").
export const NETS: Net[] = [
  { chainId: SEPOLIA_ID, name: 'Sepolia', native: 'ETH', rpc: SEPOLIA_RPC, explorer: 'https://sepolia.etherscan.io', testnet: true,
    tokens: [t('WETH', '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', 18), t('USDC', '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', 6)] },
  { chainId: 1, name: 'Ethereum', native: 'ETH', rpc: 'https://ethereum-rpc.publicnode.com', explorer: 'https://etherscan.io',
    tokens: [t('WETH', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 18), t('USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6)] },
  { chainId: ARBITRUM_ID, name: 'Arbitrum', native: 'ETH', rpc: 'https://arb1.arbitrum.io/rpc', explorer: 'https://arbiscan.io',
    tokens: [t('WETH', '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', 18), t('USDC', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 6)] },
  { chainId: 8453, name: 'Base', native: 'ETH', rpc: 'https://base-rpc.publicnode.com', explorer: 'https://basescan.org',
    tokens: [t('WETH', '0x4200000000000000000000000000000000000006', 18), t('USDC', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6)] },
  { chainId: 10, name: 'Optimism', native: 'ETH', rpc: 'https://optimism-rpc.publicnode.com', explorer: 'https://optimistic.etherscan.io',
    tokens: [t('WETH', '0x4200000000000000000000000000000000000006', 18), t('USDC', '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 6)] },
  { chainId: 137, name: 'Polygon', native: 'POL', rpc: 'https://polygon-bor-rpc.publicnode.com', explorer: 'https://polygonscan.com',
    tokens: [t('WETH', '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', 18), t('USDC', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 6)] },
];

export const netOf = (chainId: number): Net | undefined => NETS.find((n) => n.chainId === chainId);
export const hexChain = (chainId: number): string => `0x${chainId.toString(16)}`;

/** A network's built-in tokens plus the user's own (`custom`, from CoreState.tokens). */
export const tokensOn = (chainId: number, custom: Record<number, Token[]> = {}): Token[] => [...(netOf(chainId)?.tokens ?? []), ...(custom[chainId] ?? [])];

export const MAX_SYMBOL = 11;

/**
 * What a token contract says about itself is the contract's claim, not a fact.
 * Plain ASCII and a short symbol only. A symbol that a listed token or the native
 * coin already uses comes back marked with "?" and a warning, so a fake "WETH"
 * can never pass as the real one anywhere in the UI.
 */
export const checkToken = (chainId: number, address: string, symbol: unknown, decimals: unknown): { symbol: string; decimals: number; warning: string | null } => {
  const sym = typeof symbol === 'string' ? symbol.trim() : '';
  if (!/^[!-~]+$/.test(sym)) throw new Error('Token symbol is not plain text');
  if (sym.length > MAX_SYMBOL) throw new Error(`Token symbol is longer than ${MAX_SYMBOL} characters`);
  const dec = Number(decimals);
  if (!Number.isInteger(dec) || dec < 0 || dec > 36) throw new Error('Token decimals out of range');
  const net = netOf(chainId);
  const listed = net?.tokens.find((t) => t.address.toLowerCase() === address.toLowerCase());
  if (listed) return { symbol: listed.symbol, decimals: listed.decimals, warning: null };
  // Letters and digits only, any case, so "W-ETH" or "usdc" are caught too.
  const bare = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const known = ['ETH', 'WETH', 'USDC', ...(net ? [net.native, ...net.tokens.map((t) => t.symbol)] : [])].map(bare);
  const k = known.find((x) => x === bare(sym));
  return k
    ? { symbol: `${sym}?`, decimals: dec, warning: `Calls itself ${sym}, but it is not the ${k} Canon lists` }
    : { symbol: sym, decimals: dec, warning: null };
};

export const explorerTx = (hash: string, chainId: number = SEPOLIA_ID): string => `${netOf(chainId)?.explorer ?? 'https://sepolia.etherscan.io'}/tx/${hash}`;
