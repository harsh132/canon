// The hardware wallet, as the core sees it: one request at a time over USB
// serial (docs/hardware-wallet.md). The user grants the port once in a Pangolin
// page; the grant belongs to the extension's origin, so the core reopens it here.
// Dev builds can point at the JavaScript mock (apps/hw-mock) over a WebSocket.
import { FrameReader, encodeFrame, type HwResponse } from '../../shared/hwframe';
import { DEV } from '../config';
import { emit, state } from '../state';

const ESPRESSIF_VID = 0x303a;
/** Dev only: ws://… of apps/hw-mock. */
export const MOCK_KEY = 'pangolin.hwMock';

export class DeviceError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

type Link = { write: (b: Uint8Array) => Promise<void>; close: () => Promise<void> };

let link: Link | null = null;
let opening: Promise<Link> | null = null;
const reader = new FrameReader();
const waiting = new Map<number, { resolve: (r: HwResponse) => void; reject: (e: Error) => void }>();
let nextId = 1;
let queue: Promise<unknown> = Promise.resolve();

const onFrames = (bytes: Uint8Array) => {
  for (const f of reader.push(bytes) as HwResponse[]) {
    const w = waiting.get(f.id);
    if (!w) continue;
    waiting.delete(f.id);
    w.resolve(f);
  }
};

const dropped = (why: string) => {
  link = null;
  for (const [, w] of waiting) w.reject(new DeviceError(4900, why));
  waiting.clear();
  state.device = { ...state.device, connected: false, waiting: null };
  emit();
};

const openMock = (url: string): Promise<Link> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => resolve({ write: async (b) => ws.send(new Uint8Array(b)), close: async () => ws.close() });
    ws.onerror = () => reject(new DeviceError(4900, 'Mock device unreachable'));
    ws.onclose = () => dropped('Device disconnected');
    ws.onmessage = (e) => onFrames(new Uint8Array(e.data as ArrayBuffer));
  });

const openSerial = async (): Promise<Link> => {
  const serial = (navigator as Navigator & { serial?: { getPorts: () => Promise<SerialPortLike[]> } }).serial;
  if (!serial) throw new DeviceError(4900, 'This browser has no USB serial');
  const ports = await serial.getPorts();
  const port = ports.find((p) => p.getInfo().usbVendorId === ESPRESSIF_VID) ?? ports[0];
  if (!port) throw new DeviceError(4900, 'Connect your device');
  await port.open({ baudRate: 115200 });
  // Opening the port can reset the board unless both lines are released at once.
  await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  const writer = port.writable.getWriter();
  const r = port.readable.getReader();
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await r.read();
        if (done) break;
        if (value) onFrames(value);
      }
    } catch {
      // The device went away.
    }
    dropped('Device disconnected');
  })();
  return {
    write: (b) => writer.write(b),
    close: async () => {
      r.releaseLock();
      writer.releaseLock();
      await port.close().catch(() => {});
    },
  };
};

type SerialPortLike = {
  getInfo: () => { usbVendorId?: number };
  open: (o: { baudRate: number }) => Promise<void>;
  setSignals: (s: { dataTerminalReady: boolean; requestToSend: boolean }) => Promise<void>;
  close: () => Promise<void>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
};

const connect = async (): Promise<Link> => {
  if (link) return link;
  opening ??= (async () => {
    const mock = DEV ? globalThis.localStorage?.getItem(MOCK_KEY) : null;
    const l = mock ? await openMock(mock) : await openSerial();
    link = l;
    state.device = { ...state.device, connected: true };
    emit();
    return l;
  })().finally(() => {
    opening = null;
  });
  return opening;
};

/**
 * One request to the device. `confirm` names what the user approves on the
 * device; while it is pending the UI shows "Confirm on device".
 */
export const deviceRequest = <T>(m: string, p: unknown = {}, confirm: string | null = null): Promise<T> => {
  const run = async (): Promise<T> => {
    const l = await connect();
    const id = nextId++;
    if (confirm) {
      state.device = { ...state.device, waiting: confirm };
      emit();
    }
    try {
      const res = await new Promise<HwResponse>((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        // Approvals wait for a person; everything else is quick.
        const ms = confirm ? 5 * 60_000 : 15_000;
        setTimeout(() => {
          if (waiting.delete(id)) reject(new DeviceError(4900, confirm ? 'Timed out waiting for the device' : 'Device not answering'));
        }, ms);
        void l.write(encodeFrame({ id, m, p })).catch((e) => {
          waiting.delete(id);
          reject(new DeviceError(4900, (e as Error).message));
        });
      });
      if (res.e) throw new DeviceError(res.e.code, res.e.code === 4100 ? 'Unlock your device' : res.e.message);
      return res.r as T;
    } finally {
      if (confirm) {
        state.device = { ...state.device, waiting: null };
        emit();
      }
    }
  };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
};

export const disconnectDevice = async (): Promise<void> => {
  const l = link;
  link = null;
  await l?.close().catch(() => {});
};
