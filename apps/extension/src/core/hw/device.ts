// The hardware wallet, as the core sees it: one request at a time over USB
// Bluetooth or USB serial (docs/hardware-wallet.md). The user picks the device once
// in a Canon page; the grant belongs to the extension's origin, so the core
// reopens it here. Dev builds can point at the JavaScript mock (apps/hw-mock) over
// a WebSocket.
import { BLE, BLE_CHUNK, FrameReader, LINK_KEY, chunks, encodeFrame, type HwResponse } from '../../shared/hwframe';
import { DEV } from '../config';
import { emit, state } from '../state';

const ESPRESSIF_VID = 0x303a;
/** Dev only: ws://… of apps/hw-mock. */
export const MOCK_KEY = 'canon.hwMock';

export class DeviceError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

type Link = { write: (b: Uint8Array) => Promise<void>; close: () => Promise<void> };

let link: Link | null = null;
let opening: Promise<Link> | null = null;
let reader = new FrameReader();
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

/** `l` went away. A link replaced by a newer one is ignored. */
const dropped = (why: string, l: Link) => {
  if (link !== l && link !== null) return;
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
    // With Bluetooth picked, write in BLE-sized pieces, as the real link does.
    const piece = globalThis.localStorage?.getItem(LINK_KEY) === 'ble' ? BLE_CHUNK : Number.MAX_SAFE_INTEGER;
    const self: Link = {
      write: async (b) => {
        for (const c of chunks(b, piece)) ws.send(new Uint8Array(c));
      },
      close: async () => ws.close(),
    };
    ws.onopen = () => resolve(self);
    ws.onerror = () => reject(new DeviceError(4900, 'Mock device unreachable'));
    ws.onclose = () => dropped('Device disconnected', self);
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
  const self: Link = {
    write: (b) => writer.write(b),
    close: async () => {
      r.releaseLock();
      writer.releaseLock();
      await port.close().catch(() => {});
    },
  };
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
    dropped('Device disconnected', self);
  })();
  return self;
};

// Web Bluetooth, as far as the core uses it.
type Characteristic = EventTarget & {
  value?: DataView;
  startNotifications: () => Promise<unknown>;
  stopNotifications: () => Promise<unknown>;
  writeValueWithResponse: (b: Uint8Array) => Promise<void>;
};
type BleDevice = EventTarget & {
  name?: string;
  watchAdvertisements?: () => Promise<void>;
  gatt?: {
    connected: boolean;
    connect: () => Promise<{ getPrimaryService: (u: string) => Promise<{ getCharacteristic: (u: string) => Promise<Characteristic> }> }>;
    disconnect: () => void;
  };
};

const within = <T>(p: Promise<T>, ms: number, why: string): Promise<T> =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new DeviceError(4900, why)), ms))]);

const openBle = async (): Promise<Link> => {
  const bt = (navigator as Navigator & { bluetooth?: { getDevices?: () => Promise<BleDevice[]> } }).bluetooth;
  if (!bt) throw new DeviceError(4900, 'Bluetooth needs chrome://flags/#enable-web-bluetooth');
  if (!bt.getDevices) throw new DeviceError(4900, 'Bluetooth needs chrome://flags/#enable-web-bluetooth-new-permissions-backend');
  const devices = await bt.getDevices();
  const device = devices.find((d) => d.name === BLE.name) ?? devices[0];
  if (!device?.gatt) throw new DeviceError(4900, 'Choose your device');
  const gatt = device.gatt;
  // A remembered device may need to be seen advertising before it can connect.
  const server = await gatt.connect().catch(async () => {
    if (!device.watchAdvertisements) throw new DeviceError(4900, 'Device not in range');
    const seen = new Promise<void>((resolve) => device.addEventListener('advertisementreceived', () => resolve(), { once: true }));
    await device.watchAdvertisements();
    await within(seen, 15_000, 'Device not in range');
    return gatt.connect();
  });
  try {
    const svc = await server.getPrimaryService(BLE.service);
    const rx = await svc.getCharacteristic(BLE.requests);
    const tx = await svc.getCharacteristic(BLE.responses);
    tx.addEventListener('characteristicvaluechanged', () => {
      const v = tx.value;
      if (v) onFrames(new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)));
    });
    // The first encrypted access starts pairing if the computer is not bonded yet.
    await tx.startNotifications();
    const gone = () => dropped('Device disconnected', self);
    device.addEventListener('gattserverdisconnected', gone, { once: true });
    const self: Link = {
      write: async (b) => {
        for (const c of chunks(b, BLE_CHUNK)) await rx.writeValueWithResponse(c);
      },
      close: async () => {
        device.removeEventListener('gattserverdisconnected', gone);
        await tx.stopNotifications().catch(() => {});
        gatt.disconnect();
      },
    };
    return self;
  } catch (e) {
    gatt.disconnect();
    const m = (e as Error).message ?? '';
    if (/auth|encrypt|pair|insufficient/i.test(m)) throw new DeviceError(4900, 'Pair your device with this computer first');
    if (/service|characteristic/i.test(m)) throw new DeviceError(4900, 'Update your device to use Bluetooth');
    throw new DeviceError(4900, m || 'Bluetooth failed');
  }
};

type SerialPortLike = {
  getInfo: () => { usbVendorId?: number };
  open: (o: { baudRate: number }) => Promise<void>;
  setSignals: (s: { dataTerminalReady: boolean; requestToSend: boolean }) => Promise<void>;
  close: () => Promise<void>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
};

let linkKind: string | null = null;

const connect = async (): Promise<Link> => {
  const kind = globalThis.localStorage?.getItem(LINK_KEY) === 'ble' ? 'ble' : 'usb';
  // The user switched between Bluetooth and USB: drop the old link.
  if (link && linkKind !== kind) await disconnectDevice();
  if (link) return link;
  opening ??= (async () => {
    const mock = DEV ? globalThis.localStorage?.getItem(MOCK_KEY) : null;
    reader = new FrameReader();
    const l = mock ? await openMock(mock) : kind === 'ble' ? await openBle() : await openSerial();
    link = l;
    linkKind = kind;
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
