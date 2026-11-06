import { useEffect, useState } from 'react';
import { decode, encode } from '../shared/codec';
import type { Commands, CoreMessage, CoreState, Method, SwMessage } from '../shared/protocol';
import { PORT_NAME, type UiKind } from '../shared/protocol';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

let port: chrome.runtime.Port | null = null;

/** Which surface this page is: the side panel, the toolbar popup, or a prompt window. */
export const uiKind: UiKind = location.pathname.endsWith('panel.html')
  ? 'panel'
  : location.pathname.endsWith('onboard.html')
    ? 'tab'
    : new URLSearchParams(location.search).has('window')
    ? 'window'
    : 'popup';
/** The tab a side panel belongs to (panel.html?tab=N). */
export const panelTab: string | null = new URLSearchParams(location.search).get('tab');
let nextId = 1;
const pending = new Map<number, Pending>();
let latest: CoreState | null = null;
const listeners = new Set<(s: CoreState) => void>();

const connect = async (): Promise<chrome.runtime.Port> => {
  if (port) return port;
  await chrome.runtime.sendMessage({ type: 'ensure-core' } satisfies SwMessage);
  for (let attempt = 0; ; attempt += 1) {
    try {
      const p = chrome.runtime.connect({ name: `${PORT_NAME}:${uiKind}` });
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('core did not answer')), 1500);
        p.onMessage.addListener(function first(raw: string) {
          clearTimeout(t);
          p.onMessage.removeListener(first);
          handle(raw);
          resolve();
        });
        p.onDisconnect.addListener(() => {
          clearTimeout(t);
          reject(new Error('disconnected'));
        });
      });
      p.onMessage.addListener(handle);
      p.onDisconnect.addListener(() => {
        port = null;
        for (const [, w] of pending) w.reject(new Error('Core restarted'));
        pending.clear();
        void connect();
      });
      port = p;
      return p;
    } catch (e) {
      if (attempt > 20) throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
};

const handle = (raw: string): void => {
  const msg = decode<CoreMessage>(raw);
  if ('event' in msg) {
    latest = msg.state;
    for (const fn of listeners) fn(msg.state);
    return;
  }
  const w = pending.get(msg.id);
  if (!w) return;
  pending.delete(msg.id);
  if (msg.ok) w.resolve(msg.result);
  else w.reject(new Error(msg.error));
};

export const call = async <M extends Method>(method: M, params: Commands[M]['params']): Promise<Commands[M]['result']> => {
  const p = await connect();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    p.postMessage(encode({ id, method, params }));
  });
};

export const useCore = (): CoreState | null => {
  const [s, setS] = useState<CoreState | null>(latest);
  useEffect(() => {
    listeners.add(setS);
    void connect();
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
};

/** Wraps a command for a button: busy flag and a short error. */
export const useAction = () => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message.split('\n')[0].slice(0, 160));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
};
