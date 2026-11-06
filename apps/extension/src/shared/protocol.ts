// The popup <-> core contract. The popup holds no keys: it renders CoreState
// and sends one of the whitelisted Commands below. Nothing else is accepted.

export const PORT_NAME = 'pangolin-popup';

export type VaultStatus = 'none' | 'locked' | 'unlocked';

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

export type Verification = 'VALID' | 'UNKNOWN' | 'INVALID' | 'SCAM';

export type WcProposalView = {
  id: number;
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
  topic: string;
  dapp: string;
  method: string;
  title: string;
  detail: string;
  isTransaction: boolean;
  account: { index: number; address: string; label: string } | null;
};

export type CoreState = {
  vault: VaultStatus;
  chainId: number;
  railgunAddress: string | null;
  engine: { status: 'off' | 'starting' | 'ready' | 'error'; error?: string };
  sync: SyncState;
  privateBalances: TokenBalance[];
  accounts: PublicAccount[];
  activity: Activity[];
  proof: { label: string; progress: number } | null;
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
  /** Public account that pays gas when sending from private. */
  gasFrom?: number;
};

export type SendPlan = {
  kind: SendKind;
  from: 'private' | number;
  to: string;
  amount: bigint;
  symbol: string;
  gasFrom: number | null;
  gasFee: bigint;
  needsProof: boolean;
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
