import { DEFAULT_AUTO_LOCK_MIN, type CoreState } from '../shared/protocol';
import { CHAIN_ID, PRIVATE, WC_PROJECT_ID } from './config';

export const state: CoreState = {
  vault: 'unknown',
  privateNet: PRIVATE,
  siteChains: {},
  unlockWith: null,
  chainId: CHAIN_ID,
  railgunAddress: null,
  name: null,
  engine: { status: 'off' },
  sync: { status: 'idle', progress: 0 },
  privateBalances: [],
  pendingEta: null,
  tokens: {},
  accounts: [],
  activity: [],
  proof: null,
  sites: [],
  tabs: {},
  broadcaster: { status: 'off', count: 0 },
  rpc: { mode: 'nox', status: 'off', counts: { mixed: 0, clear: 0, bootstrap: 0, sync: 0, artifacts: 0, other: 0 } },
  autoLockMin: DEFAULT_AUTO_LOCK_MIN,
  wc: { configured: Boolean(WC_PROJECT_ID), ready: false, sessions: [], proposal: null, request: null },
};

type Listener = (s: CoreState) => void;
const listeners = new Set<Listener>();
let queued = false;

export const onState = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Coalesces bursts (scan progress fires often) into one push per tick. */
export const emit = (): void => {
  if (queued) return;
  queued = true;
  setTimeout(() => {
    queued = false;
    for (const fn of listeners) fn(state);
  }, 30);
};
