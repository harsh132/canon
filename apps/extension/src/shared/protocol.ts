// The popup <-> core contract. The popup holds no keys: it renders CoreState
// and sends one of the whitelisted Commands below. Nothing else is accepted.

export const PORT_NAME = 'pangolin-popup';
export const DAPP_PORT_NAME = 'pangolin-dapp';

/** 'unknown' until the core has read storage; the popup must not offer onboarding before then. */
export type VaultStatus = 'unknown' | 'none' | 'locked' | 'unlocked';

export type TokenBalance = {
  token: string;
  symbol: string;
  decimals: number;
  spendable: bigint;
  pending: bigint;
};

export type PublicAccount = {
  index: number;
  address: string;
  label: string;
  /** Dapp origins bound to this account. Empty for accounts the user made. */
  origins: string[];
  /** Wei, or null until read. Reads happen only when the user asks. */
  balance: bigint | null;
};

export type SyncState = {
  status: 'idle' | 'syncing' | 'done' | 'error';
  progress: number;
  error?: string;
  at?: number;
};

export type Activity = {
  id: string;
  kind: SendKind | 'dapp';
  label: string;
  amount?: string;
  hash?: string;
  at: number;
  status: 'pending' | 'done' | 'failed';
};

export type WcSessionView = {
  topic: string;
  name: string;
  url: string;
  icon: string | null;
  address: string;
};

/** BROWSER: the origin came from Chrome itself (injected provider), so it cannot be forged by the page. */
export type Verification = 'VALID' | 'UNKNOWN' | 'INVALID' | 'SCAM' | 'BROWSER';

export type WcProposalView = {
  id: number;
  source: 'wc' | 'browser';
  name: string;
  origin: string | null;
  attested: boolean;
  verification: Verification;
  icon: string | null;
  canApprove: boolean;
  problem?: string;
  /** What the dapp will see. A fresh address for a first contact. */
  account: { index: number; address: string; label: string; isNew: boolean } | null;
};

export type WcRequestView = {
  id: number;
  source: 'wc' | 'browser';
  topic: string;
  dapp: string;
  method: string;
  title: string;
  detail: string;
  isTransaction: boolean;
  account: { index: number; address: string; label: string } | null;
};

export type RpcState = {
  mode: 'nox' | 'direct';
  status: 'off' | 'booting' | 'ready' | 'error';
  error?: string;
  bootMs?: number;
  /** mixed: through Nox. clear: RPC sent directly. bootstrap: the worker's own specifier reads.
   *  sync / artifacts: bulk public downloads that name no one. other: non-RPC requests (relay, bundle). */
  counts: { mixed: number; clear: number; bootstrap: number; sync: number; artifacts: number; other: number };
};

export type CoreState = {
  vault: VaultStatus;
  chainId: number;
  railgunAddress: string | null;
  /** This wallet's name, if claimed. */
  name: string | null;
  engine: { status: 'off' | 'starting' | 'ready' | 'error'; error?: string };
  sync: SyncState;
  privateBalances: TokenBalance[];
  accounts: PublicAccount[];
  activity: Activity[];
  proof: { label: string; progress: number } | null;
  rpc: RpcState;
  /** RAILGUN broadcasters over Waku. count: distinct broadcasters seen on Sepolia. */
  broadcaster: { status: 'off' | 'connecting' | 'connected' | 'none' | 'error'; count: number; error?: string };
  /** Sites connected through the injected provider. */
  sites: { origin: string; address: string; label: string }[];
  wc: {
    configured: boolean;
    ready: boolean;
    error?: string;
    sessions: WcSessionView[];
    proposal: WcProposalView | null;
    request: WcRequestView | null;
  };
};

export type SendKind = 'send' | 'shield' | 'unshield' | 'transfer';

/** `from`: 'private', or the HD index of a public account. */
export type SendIntent = {
  from: 'private' | number;
  to: string;
  amount: string;
  /** Who pays gas when sending from private: Pangolin's sponsor (default), a RAILGUN broadcaster, or a public account. */
  via?: 'sponsor' | 'broadcaster' | 'self';
  /** Public account that pays gas when via is 'self'. */
  gasFrom?: number;
};

export type SendPlan = {
  kind: SendKind;
  from: 'private' | number;
  to: string;
  amount: bigint;
  symbol: string;
  gasFrom: number | null;
  /** Native gas the user pays from a public account. Zero via a broadcaster. */
  gasFee: bigint;
  /** Fee in private WETH when a broadcaster or the sponsor pays gas (0 for the testnet sponsor). */
  broadcasterFee: bigint | null;
  needsProof: boolean;
  /** Set when the user typed a name: what it resolved to, and from which record. */
  name?: string;
  resolvedVia?: 'org.railgun' | 'addr';
};

export type Commands = {
  'vault.create': { params: { password: string }; result: { mnemonic: string } };
  'vault.import': { params: { password: string; mnemonic: string }; result: null };
  'vault.unlock': { params: { password: string }; result: null };
  'vault.lock': { params: null; result: null };
  'vault.reset': { params: null; result: null };
  'railgun.sync': { params: null; result: null };
  'accounts.refresh': { params: null; result: null };
  'accounts.create': { params: { label: string }; result: PublicAccount };
  'send.plan': { params: SendIntent; result: SendPlan };
  'send.execute': { params: SendIntent; result: { hash: string } };
  'rpc.setMode': { params: { mode: 'nox' | 'direct' }; result: null };
  'ens.claim': { params: { label: string }; result: { name: string } };
  'dapp.disconnect': { params: { origin: string }; result: null };
  'wc.pair': { params: { uri: string }; result: null };
  'wc.chooseAccount': { params: { index: number | 'new' }; result: null };
  'wc.approve': { params: null; result: null };
  'wc.reject': { params: null; result: null };
  'wc.approveRequest': { params: null; result: null };
  'wc.rejectRequest': { params: null; result: null };
  'wc.disconnect': { params: { topic: string }; result: null };
};

export type Method = keyof Commands;

export type Request = { id: number; method: Method; params: unknown };
export type Response = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
export type Push = { event: 'state'; state: CoreState };
export type CoreMessage = Response | Push;

/** Messages to the service worker. */
export type SwMessage = { type: 'ensure-core' } | { type: 'prompt' } | { type: 'prompt-clear' };
