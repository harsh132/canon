// Canon hardware-wallet frames (docs/hardware-wallet.md), shared by the
// extension, the JavaScript mock device and the test vectors:
//   0x02 'C' 'W' 0x01 | length u32 LE | JSON (UTF-8) | CRC32 u32 LE of the JSON

export const FRAME_MAGIC = [0x02, 0x43, 0x57, 0x01] as const;
const HEADER = 8;
const TRAILER = 4;
/** Larger than any request we send (a typed-data payload or a clear-sign request). */
export const MAX_FRAME_JSON = 64 * 1024;

/** The Bluetooth link (docs/hardware-wallet.md, "Bluetooth (BLE)"). */
export const BLE = {
  service: '3dff3ba4-599b-4084-b915-020fd7c35f03',
  requests: '3dff3ba5-599b-4084-b915-020fd7c35f03',
  responses: '3dff3ba6-599b-4084-b915-020fd7c35f03',
  name: 'Buddy',
} as const;
/** Largest piece Canon writes to the requests characteristic. */
export const BLE_CHUNK = 180;

/** Which link the user picked in a Canon page (localStorage, shared by the UI and the core). */
export const LINK_KEY = 'canon.hwLink';
export type HwLink = 'ble' | 'usb';

/** A frame cut into pieces of at most `size` bytes, in order. */
export const chunks = (bytes: Uint8Array, size: number): Uint8Array[] => {
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size));
  return out;
};

export type HwRequest = { id: number; m: string; p?: unknown };
export type HwResponse = { id: number; r?: unknown; e?: { code: number; message: string } };

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE 802.3), the same as esp_rom_crc32_le(0, …) on the device. */
export const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (const b of bytes) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

export const encodeFrame = (msg: HwRequest | HwResponse): Uint8Array => {
  const json = new TextEncoder().encode(JSON.stringify(msg));
  if (json.length > MAX_FRAME_JSON) throw new Error('Frame too large');
  const out = new Uint8Array(HEADER + json.length + TRAILER);
  out.set(FRAME_MAGIC, 0);
  const view = new DataView(out.buffer);
  view.setUint32(4, json.length, true);
  out.set(json, HEADER);
  view.setUint32(HEADER + json.length, crc32(json), true);
  return out;
};

/**
 * Pulls whole frames out of a byte stream. The device's log lines and console
 * output share the port, so anything that is not a frame is skipped, and a bad
 * CRC resyncs one byte later.
 */
export class FrameReader {
  #buf = new Uint8Array(0);

  push(chunk: Uint8Array): unknown[] {
    const next = new Uint8Array(this.#buf.length + chunk.length);
    next.set(this.#buf, 0);
    next.set(chunk, this.#buf.length);
    this.#buf = next;
    const out: unknown[] = [];
    for (;;) {
      const start = this.#find();
      if (start < 0) {
        // Keep a possible partial magic at the end.
        this.#buf = this.#buf.slice(Math.max(0, this.#buf.length - (FRAME_MAGIC.length - 1)));
        return out;
      }
      if (start > 0) this.#buf = this.#buf.slice(start);
      if (this.#buf.length < HEADER) return out;
      const len = new DataView(this.#buf.buffer, this.#buf.byteOffset).getUint32(4, true);
      if (len > MAX_FRAME_JSON) {
        this.#buf = this.#buf.slice(1);
        continue;
      }
      if (this.#buf.length < HEADER + len + TRAILER) return out;
      const json = this.#buf.slice(HEADER, HEADER + len);
      const crc = new DataView(this.#buf.buffer, this.#buf.byteOffset).getUint32(HEADER + len, true);
      if (crc !== crc32(json)) {
        // Not a real frame (or a damaged one): skip one byte and rescan, so a real
        // frame inside the bytes we would have consumed is still found.
        this.#buf = this.#buf.slice(1);
        continue;
      }
      this.#buf = this.#buf.slice(HEADER + len + TRAILER);
      try {
        out.push(JSON.parse(new TextDecoder().decode(json)));
      } catch {
        // A frame with a good CRC but bad JSON is dropped.
      }
    }
  }

  #find(): number {
    for (let i = 0; i + FRAME_MAGIC.length <= this.#buf.length; i += 1) {
      if (FRAME_MAGIC.every((b, k) => this.#buf[i + k] === b)) return i;
    }
    return -1;
  }
}
