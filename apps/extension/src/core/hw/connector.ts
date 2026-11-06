// RAILGUN's HardwareWallet calls this to sign a private transaction. Pangolin
// only clear-signs: the device sees recipients, tokens and amounts, builds the
// outputs itself, and the engine verifies every byte it returns
// (engine transaction/clear-sign-verify.js) before proving.
import { deviceRequest } from './device';

type Bytes = Uint8Array;
type Output =
  | { kind: 'broadcaster'; recipientMasterPublicKey: Bytes; recipientViewingPublicKey: Bytes; tokenHash: Bytes; value: bigint }
  | { kind: 'change'; tokenHash: Bytes; value: bigint }
  | { kind: 'transfer'; recipient0zk: string; tokenHash: Bytes; value: bigint; outputType?: number; memo?: Bytes }
  | { kind: 'unshield'; recipientAddress: Bytes; tokenHash: Bytes; value: bigint };
type ClearSignRequest = {
  account?: number;
  merkleRoot: Bytes;
  nullifiers: readonly Bytes[];
  boundParams: { treeNumber: number; minGasPrice: bigint; unshield: boolean; chainId: bigint; adaptContract?: Bytes; adaptParams?: Bytes };
  outputs: readonly Output[];
};
type EngineSignature = { R8: [bigint, bigint]; S: bigint };

const hex = (b: Bytes) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
const bytes = (h: string): Bytes => Uint8Array.from((h.replace(/^0x/, '').match(/../g) ?? []).map((x) => Number.parseInt(x, 16)));

const toWire = (r: ClearSignRequest) => ({
  account: r.account ?? 0,
  walletSource: 'pangolin',
  merkleRoot: hex(r.merkleRoot),
  nullifiers: r.nullifiers.map(hex),
  boundParams: {
    treeNumber: r.boundParams.treeNumber,
    minGasPrice: r.boundParams.minGasPrice.toString(),
    unshield: r.boundParams.unshield,
    chainId: r.boundParams.chainId.toString(),
    ...(r.boundParams.adaptContract ? { adaptContract: hex(r.boundParams.adaptContract) } : {}),
    ...(r.boundParams.adaptParams ? { adaptParams: hex(r.boundParams.adaptParams) } : {}),
  },
  outputs: r.outputs.map((o) => {
    const base = { kind: o.kind, tokenHash: hex(o.tokenHash), value: o.value.toString() };
    switch (o.kind) {
      case 'transfer':
        return { ...base, recipient0zk: o.recipient0zk, ...(o.outputType != null ? { outputType: o.outputType } : {}), ...(o.memo ? { memo: hex(o.memo) } : {}) };
      case 'broadcaster':
        return { ...base, recipientMasterPublicKey: hex(o.recipientMasterPublicKey), recipientViewingPublicKey: hex(o.recipientViewingPublicKey) };
      case 'unshield':
        return { ...base, recipientAddress: hex(o.recipientAddress) };
      default:
        return base;
    }
  }),
});

export const railgunConnector = {
  async sign(_expectedHash: bigint, _publicInputs?: unknown, _subSession?: string, clearSign?: ClearSignRequest) {
    if (!clearSign) throw new Error('Pangolin clear-signs only; this transaction could not be clear-signed');
    const r = await deviceRequest<{ signature: { R8: [string, string]; S: string }; msgHash: string; outputs: { kind: Output['kind']; response: string }[] }>(
      'railgunClearSign',
      { request: toWire(clearSign) },
      'Send privately',
    );
    const signature: EngineSignature = { R8: [BigInt(r.signature.R8[0]), BigInt(r.signature.R8[1])], S: BigInt(r.signature.S) };
    return { ...signature, clearSign: { msgHash: bytes(r.msgHash), outputs: r.outputs.map((o) => ({ kind: o.kind, response: bytes(o.response) })) } };
  },
};
