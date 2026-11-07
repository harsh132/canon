// The mock device over a WebSocket, for Canon's tests (dev builds read the
// URL from localStorage "canon.hwMock").
//   HW_MOCK_SEED="…" HW_MOCK_DELAY_MS=600 bun src/server.ts
// HW_MOCK_MTU=23 acts like the Bluetooth link: replies cut into MTU − 3 byte
// notifications and no log lines.
// Control: POST /reject-next makes the next approval a reject; GET /log lists the screens shown.
import { FrameReader, chunks, encodeFrame, type HwRequest } from '../../extension/src/shared/hwframe';
import { MockDevice } from './device';

const PORT = Number(process.env.HW_MOCK_PORT ?? 8799);
const SEED = process.env.HW_MOCK_SEED ?? 'test test test test test test test test test test test junk';
const DELAY = Number(process.env.HW_MOCK_DELAY_MS ?? 600);
const MTU = Number(process.env.HW_MOCK_MTU ?? 0);
let rejectNext = false;
const shown: { title: string; lines: string[]; approved: boolean }[] = [];

const device = new MockDevice(SEED, {
  confirm: async (screen) => {
    await new Promise((r) => setTimeout(r, DELAY));
    const approved = !rejectNext;
    rejectNext = false;
    shown.push({ ...screen, approved });
    return approved;
  },
});

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === '/reject-next') {
      rejectNext = true;
      return new Response('ok');
    }
    if (url.pathname === '/log') return Response.json(shown);
    if (server.upgrade(req, { data: { reader: new FrameReader() } })) return undefined;
    return new Response('canon hw-mock', { status: 426 });
  },
  websocket: {
    async message(ws, msg) {
      if (MTU && typeof msg !== 'string' && msg.byteLength > 180) console.log('[hw-mock] write larger than a BLE piece:', msg.byteLength);
      const reader = (ws.data as { reader: FrameReader }).reader;
      const bytes = typeof msg === 'string' ? new TextEncoder().encode(msg) : new Uint8Array(msg);
      for (const req of reader.push(bytes) as HwRequest[]) {
        const res = await device.handle(req);
        if (MTU) {
          for (const c of chunks(encodeFrame(res), MTU - 3)) ws.send(c);
          continue;
        }
        // Log noise on the same channel, as on the real device's shared USB port.
        ws.send(new TextEncoder().encode(`I (${Date.now() % 100000}) wallet: ${req.m}\n`));
        ws.send(encodeFrame(res));
      }
    },
  },
});
console.log(`[hw-mock] ws://127.0.0.1:${PORT}`);
