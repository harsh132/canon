// An ethers signer whose key is on the hardware wallet. Everything that signs
// goes to the device and waits for a press there.
import {
  AbstractSigner,
  Signature,
  Transaction,
  TypedDataEncoder,
  getAddress,
  getBytes,
  hexlify,
  resolveAddress,
  toUtf8Bytes,
  type Authorization,
  type AuthorizationRequest,
  type Provider,
  type TransactionLike,
  type TransactionRequest,
  type TypedDataDomain,
  type TypedDataField,
} from 'ethers';
import { deviceRequest } from './device';

export class DeviceSigner extends AbstractSigner {
  readonly address: string;
  readonly path: string;

  constructor(address: string, path: string, provider: Provider | null = null) {
    super(provider);
    this.address = getAddress(address);
    this.path = path;
  }

  getAddress(): Promise<string> {
    return Promise.resolve(this.address);
  }

  connect(provider: Provider | null): DeviceSigner {
    return new DeviceSigner(this.address, this.path, provider);
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    const bytes = typeof message === 'string' ? toUtf8Bytes(message) : message;
    const { signature } = await deviceRequest<{ signature: string }>('signMessage', { path: this.path, message: hexlify(bytes) }, 'Sign message');
    return signature;
  }

  async signTypedData(domain: TypedDataDomain, types: Record<string, TypedDataField[]>, value: Record<string, unknown>): Promise<string> {
    // Resolve names first, so the device hashes exactly what the dapp meant.
    const populated = await TypedDataEncoder.resolveNames(domain, types, value, async (name) => (await resolveAddress(name, this.provider)) as string);
    const typedData = TypedDataEncoder.getPayload(populated.domain, types, populated.value);
    const { signature } = await deviceRequest<{ signature: string }>('signTypedData', { path: this.path, typedData }, `Sign ${typedData.primaryType}`);
    return signature;
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    const populated = await this.populateTransaction(tx);
    const t = Transaction.from(populated as TransactionLike<string>);
    if (t.type !== 2) throw new Error('Only type-2 transactions are signed on the device');
    const p = {
      chainId: t.chainId.toString(),
      nonce: String(t.nonce),
      maxFeePerGas: (t.maxFeePerGas ?? 0n).toString(),
      maxPriorityFeePerGas: (t.maxPriorityFeePerGas ?? 0n).toString(),
      gas: t.gasLimit.toString(),
      to: t.to,
      value: t.value.toString(),
      data: t.data,
    };
    const { signature } = await deviceRequest<{ signature: { r: string; s: string; yParity: 0 | 1 } }>('signTransaction', { path: this.path, tx: p }, 'Send transaction');
    t.signature = Signature.from(signature);
    if (getAddress(t.from as string) !== this.address) throw new Error('Device signed with a different key');
    return t.serialized;
  }

  async authorize(auth: AuthorizationRequest): Promise<Authorization> {
    const a = await this.populateAuthorization(auth);
    const address = await resolveAddress(a.address, this.provider);
    const sig = await deviceRequest<{ r: string; s: string; yParity: 0 | 1 }>(
      'signAuthorization',
      { path: this.path, chainId: String(a.chainId), address, nonce: String(a.nonce) },
      'Make this a smart account',
    );
    return { address, nonce: BigInt(a.nonce ?? 0), chainId: BigInt(a.chainId ?? 0), signature: Signature.from(sig) };
  }
}

export { getBytes };
