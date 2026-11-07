// A software Canon hardware wallet: the protocol in docs/hardware-wallet.md,
// built from the RAILGUN engine's own primitives so its clear-sign output is
// exactly what the engine verifies. Used by Canon's tests (over a WebSocket)
// and as the source of the BuddyOS firmware's test vectors.
//
// Not a wallet: the seed is in memory, approval is a callback.
import { createCipheriv, randomBytes } from 'node:crypto';
import { HDNodeWallet, Signature, getAddress, getBytes, hexlify, isHexString, toUtf8String, Transaction } from 'ethers';
import type { HwRequest, HwResponse } from '../../extension/src/shared/hwframe';
import { Babyjubjub, ByteLength, ByteUtils, Memo, TransactNote, WalletNode, constants, decodeAddress, deriveNodes, hashBoundParamsV2, keys, msgpack, poseidon } from './engine';

export const CALIBUR = '0x000000009B1D0aF20D8C6d0A44e162d11F9b8f00';
export const VAULT_MESSAGE = 'Canon vault key v1';
const VAULT_PATH = "m/44'/60'/0'/0/0";
const ZERO20 = '0x0000000000000000000000000000000000000000';
const ZERO32 = `0x${'00'.repeat(32)}`;

export type Confirm = (screen: { title: string; lines: string[] }) => Promise<boolean>;
export type Rng = (bytes: number) => Uint8Array;

class DeviceError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

const strip = (h: string) => h.replace(/^0x/, '').toLowerCase();
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const beBytes = (n: bigint, len: number) => getBytes(`0x${n.toString(16).padStart(len * 2, '0')}`);

type Output =
  | { kind: 'transfer'; recipient0zk: string; tokenHash: string; value: string; outputType?: number; memo?: string }
  | { kind: 'change'; tokenHash: string; value: string }
  | { kind: 'broadcaster'; recipientMasterPublicKey: string; recipientViewingPublicKey: string; tokenHash: string; value: string }
  | { kind: 'unshield'; recipientAddress: string; tokenHash: string; value: string };

export type ClearSignRequest = {
  account?: number;
  /** Canon extension to the Ledger contract: the wallet source folded into transfer annotations. */
  walletSource?: string;
  merkleRoot: string;
  nullifiers: string[];
  boundParams: { treeNumber: number; minGasPrice: string; unshield: boolean; chainId: string; adaptContract?: string; adaptParams?: string };
  outputs: Output[];
};

/** Intermediate values, written into test vectors so firmware can be debugged step by step. */
export type ClearSignTrace = {
  senderMasterPublicKey: string;
  outputs: { random?: string; senderRandom?: string; iv?: string; annotationIv?: string; notePublicKey?: string; commitment: string; sharedKey?: string }[];
  boundParamsHash: string;
};

export class MockDevice {
  #mnemonic: string;
  #confirm: Confirm;
  #rng: Rng;
  #walletSource: string;
  trace: ClearSignTrace | null = null;

  constructor(mnemonic: string, opts: { confirm?: Confirm; rng?: Rng; walletSource?: string } = {}) {
    this.#mnemonic = mnemonic;
    this.#confirm = opts.confirm ?? (async () => true);
    this.#rng = opts.rng ?? ((n) => new Uint8Array(randomBytes(n)));
    this.#walletSource = opts.walletSource ?? 'canon';
  }

  async handle(req: HwRequest): Promise<HwResponse> {
    try {
      return { id: req.id, r: await this.#dispatch(req.m, (req.p ?? {}) as Record<string, unknown>) };
    } catch (e) {
      const code = e instanceof DeviceError ? e.code : -32603;
      return { id: req.id, e: { code, message: (e as Error).message } };
    }
  }

  #wallet(path: unknown): HDNodeWallet {
    if (typeof path !== 'string' || !/^m(\/\d+'?)+$/.test(path)) throw new DeviceError(-32602, 'Bad path');
    return HDNodeWallet.fromPhrase(this.#mnemonic, undefined, path);
  }

  async #approve(title: string, lines: string[]): Promise<void> {
    if (!(await this.#confirm({ title, lines }))) throw new DeviceError(4001, 'Rejected on device');
  }

  async #dispatch(m: string, p: Record<string, unknown>): Promise<unknown> {
    switch (m) {
      case 'info':
        return { fw: 'canon-mock/0.1', hasSeed: true, locked: false };
      case 'getAddresses': {
        const paths = p.paths as string[];
        if (!Array.isArray(paths) || paths.length === 0 || paths.length > 32) throw new DeviceError(-32602, 'Bad paths');
        return { addresses: paths.map((path) => this.#wallet(path).address) };
      }
      case 'vaultKey': {
        await this.#approve('Unlock Canon', []);
        return { signature: await this.#wallet(VAULT_PATH).signMessage(VAULT_MESSAGE) };
      }
      case 'getViewingKey': {
        await this.#approve('Let Canon see your private balance', []);
        return { shareableViewingKey: await this.shareableViewingKey(Number(p.account ?? 0)) };
      }
      case 'signMessage': {
        const msg = getBytes(String(p.message));
        let shown: string;
        try {
          shown = toUtf8String(msg);
        } catch {
          shown = hexlify(msg);
        }
        await this.#approve('Sign message', [shown]);
        return { signature: await this.#wallet(p.path).signMessage(msg) };
      }
      case 'signTypedData': {
        const td = p.typedData as { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> };
        const types = { ...td.types } as Record<string, never>;
        delete types.EIP712Domain;
        await this.#approve(`Sign ${td.primaryType}`, [String(td.domain?.name ?? ''), `chain ${String(td.domain?.chainId ?? '')}`]);
        return { signature: await this.#wallet(p.path).signTypedData(td.domain, types, td.message) };
      }
      case 'signTransaction': {
        const t = p.tx as Record<string, string>;
        const tx = Transaction.from({
          type: 2,
          chainId: BigInt(t.chainId),
          nonce: Number(t.nonce),
          maxFeePerGas: BigInt(t.maxFeePerGas),
          maxPriorityFeePerGas: BigInt(t.maxPriorityFeePerGas),
          gasLimit: BigInt(t.gas),
          to: t.to ? getAddress(t.to) : null,
          value: BigInt(t.value ?? '0'),
          data: t.data ?? '0x',
        });
        await this.#approve('Send transaction', [`chain ${tx.chainId}`, `to ${tx.to}`, `value ${tx.value}`, `call ${tx.data.slice(0, 10)}`]);
        const sig = this.#wallet(p.path).signingKey.sign(tx.unsignedHash);
        return { signature: { r: sig.r, s: sig.s, yParity: sig.yParity } };
      }
      case 'signAuthorization': {
        if (getAddress(String(p.address)) !== getAddress(CALIBUR)) throw new DeviceError(4001, 'Only Calibur delegations are allowed');
        await this.#approve('Make this a smart account', [`chain ${String(p.chainId)}`]);
        const auth = await this.#wallet(p.path).authorize({ address: CALIBUR, chainId: BigInt(String(p.chainId)), nonce: BigInt(String(p.nonce)) });
        return { r: auth.signature.r, s: auth.signature.s, yParity: auth.signature.yParity };
      }
      case 'railgunClearSign':
        return this.clearSign(p.request as ClearSignRequest);
      default:
        throw new DeviceError(4200, `${m} is not supported`);
    }
  }

  async #railgunKeys(account: number) {
    const nodes = deriveNodes(this.#mnemonic, account);
    const spending = nodes.spending.getSpendingKeyPair();
    const viewing = await nodes.viewing.getViewingKeyPair();
    const nullifyingKey = await nodes.viewing.getNullifyingKey();
    const masterPublicKey: bigint = WalletNode.getMasterPublicKey(spending.pubkey, nullifyingKey);
    return { spending, viewing, masterPublicKey };
  }

  async shareableViewingKey(account: number): Promise<string> {
    const { spending, viewing } = await this.#railgunKeys(account);
    return msgpack
      .encode({
        vpriv: ByteUtils.formatToByteLength(hex(viewing.privateKey), ByteLength.UINT_256),
        spub: Babyjubjub.packPoint(spending.pubkey).toString('hex'),
      })
      .toString('hex');
  }

  async clearSign(req: ClearSignRequest) {
    const n = req.nullifiers?.length ?? 0;
    const m = req.outputs?.length ?? 0;
    if (n < 1 || n > 4 || m < 1 || m > 3 || n + m > 5) throw new DeviceError(-32602, 'Transaction shape not clear-signable');
    const { spending, viewing, masterPublicKey: senderMPK } = await this.#railgunKeys(req.account ?? 0);

    await this.#approve(
      'Send privately',
      req.outputs.map((o) => `${o.kind} ${'recipient0zk' in o ? `${o.recipient0zk.slice(0, 12)}…` : 'recipientAddress' in o ? o.recipientAddress : ''} ${o.value}`),
    );

    const trace: ClearSignTrace = { senderMasterPublicKey: senderMPK.toString(), outputs: [], boundParamsHash: '' };
    const ciphertexts: unknown[] = [];
    const commitments: bigint[] = [];
    const responses: { kind: string; response: string }[] = [];

    for (const o of req.outputs) {
      const tokenHash = strip(o.tokenHash).padStart(64, '0');
      const value = BigInt(o.value);
      if (o.kind === 'unshield') {
        // No randomness: npk is the recipient address.
        const commitment: bigint = poseidon([BigInt(getAddress(o.recipientAddress)), BigInt(`0x${tokenHash}`), value]);
        commitments.push(commitment);
        responses.push({ kind: 'unshield', response: `0x${hex(beBytes(commitment, 32))}` });
        trace.outputs.push({ commitment: commitment.toString() });
        continue;
      }
      let receiverMPK: bigint;
      let receiverVPK: Uint8Array;
      if (o.kind === 'transfer') {
        const addr = decodeAddress(o.recipient0zk);
        receiverMPK = addr.masterPublicKey;
        receiverVPK = addr.viewingPublicKey;
      } else if (o.kind === 'change') {
        receiverMPK = senderMPK;
        receiverVPK = viewing.pubkey;
      } else {
        receiverMPK = BigInt(`0x${strip(o.recipientMasterPublicKey)}`);
        receiverVPK = getBytes(`0x${strip(o.recipientViewingPublicKey)}`);
      }
      const random = hex(this.#rng(16));
      const senderRandom = o.kind === 'transfer' ? hex(this.#rng(15)) : constants.MEMO_SENDER_RANDOM_NULL;
      const { blindedSenderViewingKey, blindedReceiverViewingKey } = keys.getNoteBlindingKeys(viewing.pubkey, receiverVPK, random, senderRandom);
      const sharedKey: Uint8Array = await keys.getSharedSymmetricKey(viewing.privateKey, blindedReceiverViewingKey);
      const encodedMPK: bigint = TransactNote.getEncodedMasterPublicKey(senderRandom, receiverMPK, senderMPK);
      const plaintext = [
        ByteUtils.nToHex(encodedMPK, ByteLength.UINT_256),
        tokenHash,
        `${random}${ByteUtils.nToHex(value, ByteLength.UINT_128)}`,
      ];
      const iv = this.#rng(16);
      const cipher = createCipheriv('aes-256-gcm', sharedKey, iv, { authTagLength: 16 });
      const blocks = plaintext.map((b) => hex(cipher.update(Buffer.from(b, 'hex'))));
      cipher.final();
      const tag = hex(cipher.getAuthTag());

      const notePublicKey: bigint = poseidon([receiverMPK, BigInt(`0x${random}`)]);
      const commitment: bigint = poseidon([notePublicKey, BigInt(`0x${tokenHash}`), value]);
      commitments.push(commitment);

      let annotationIv: string | undefined;
      let annotationData = '0x';
      if (o.kind === 'transfer') {
        annotationIv = hex(this.#rng(16));
        const outputType = o.outputType ?? 0;
        annotationData = ByteUtils.hexlify(Memo.createEncryptedNoteAnnotationDataV2(outputType, senderRandom, req.walletSource ?? this.#walletSource, viewing.privateKey, annotationIv), true);
      }
      ciphertexts.push({
        ciphertext: [`0x${hex(iv)}${tag}`, `0x${blocks[0]}`, `0x${blocks[1]}`, `0x${blocks[2]}`],
        blindedSenderViewingKey: `0x${hex(blindedSenderViewingKey)}`,
        blindedReceiverViewingKey: `0x${hex(blindedReceiverViewingKey)}`,
        annotationData,
        memo: '0x',
      });

      const response = random + hex(blindedSenderViewingKey) + hex(blindedReceiverViewingKey) + hex(iv) + tag + blocks.join('') + senderRandom + (annotationIv ?? '');
      responses.push({ kind: o.kind, response: `0x${response}` });
      trace.outputs.push({ random, senderRandom, iv: hex(iv), annotationIv, notePublicKey: notePublicKey.toString(), commitment: commitment.toString(), sharedKey: hex(sharedKey) });
    }

    const bp = req.boundParams;
    const boundParamsHash: bigint = hashBoundParamsV2({
      treeNumber: BigInt(bp.treeNumber),
      minGasPrice: BigInt(bp.minGasPrice),
      unshield: bp.unshield ? constants.UnshieldFlag.UNSHIELD : constants.UnshieldFlag.NO_UNSHIELD,
      chainID: BigInt(bp.chainId),
      adaptContract: bp.adaptContract ? getAddress(bp.adaptContract) : ZERO20,
      adaptParams: bp.adaptParams ?? ZERO32,
      commitmentCiphertext: ciphertexts,
    });
    trace.boundParamsHash = boundParamsHash.toString();
    const msgHash: bigint = poseidon([BigInt(req.merkleRoot), boundParamsHash, ...req.nullifiers.map((x) => BigInt(x)), ...commitments]);
    const sig = keys.signEDDSA(spending.privateKey, msgHash) as { R8: [bigint, bigint]; S: bigint };
    this.trace = trace;
    return {
      signature: { R8: [sig.R8[0].toString(), sig.R8[1].toString()], S: sig.S.toString() },
      msgHash: `0x${hex(beBytes(msgHash, 32))}`,
      outputs: responses,
    };
  }
}

export { Signature, isHexString };
