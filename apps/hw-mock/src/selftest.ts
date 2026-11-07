// Checks the mock device against the RAILGUN engine's own verifier, and writes
// test vectors for the BuddyOS firmware.
//   bun src/selftest.ts           check only
//   bun src/selftest.ts --write   also write vectors/*.json
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { HDNodeWallet, Transaction, TypedDataEncoder, getBytes, hashMessage, recoverAddress, verifyAuthorization, verifyMessage, verifyTypedData } from 'ethers';
import { encodeFrame, FrameReader } from '../../extension/src/shared/hwframe';
import { CALIBUR, MockDevice, VAULT_MESSAGE, type ClearSignRequest } from './device';
import { ByteUtils, constants, deriveNodes, encodeAddress, hashBoundParamsV2, poseidon, TransactNote, verify, WalletNode } from './engine';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const engineRoot = join(dirname(require.resolve('@railgun-community/engine')), '..');
const { UnshieldNote } = require(join(engineRoot, 'dist/note/unshield-note.js'));
const { getTokenDataERC20 } = require(join(engineRoot, 'dist/note/note-util.js'));
const WalletInfo = require(join(engineRoot, 'dist/wallet/wallet-info.js')).default;
const { OutputType } = require(join(engineRoot, 'dist/models/formatted-types.js'));

const WRITE = process.argv.includes('--write');
const OUT = new URL('../vectors/', import.meta.url).pathname;
const MNEMONIC = 'test test test test test test test test test test test junk';
const RECIPIENT_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';
const TOKEN_HASH = `0x${'00'.repeat(12)}${WETH.slice(2).toLowerCase()}`;

let fails = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) fails += 1;
  console.log(ok ? 'ok  ' : 'FAIL', what);
};

/** A fixed random stream: sha256(seed || counter), so vectors are reproducible on the device. */
const streamRng = (seed: string) => {
  let counter = 0;
  const consumed: string[] = [];
  const rng = (n: number) => {
    const out = new Uint8Array(n);
    let filled = 0;
    while (filled < n) {
      const block = createHash('sha256').update(`${seed}:${counter}`).digest();
      counter += 1;
      const take = Math.min(32, n - filled);
      out.set(block.subarray(0, take), filled);
      filled += take;
    }
    consumed.push(Buffer.from(out).toString('hex'));
    return out;
  };
  return { rng, consumed };
};

const railgunAddress = async (mnemonic: string) => {
  const nodes = deriveNodes(mnemonic, 0);
  const spending = nodes.spending.getSpendingKeyPair();
  const viewing = await nodes.viewing.getViewingKeyPair();
  const masterPublicKey: bigint = WalletNode.getMasterPublicKey(spending.pubkey, await nodes.viewing.getNullifyingKey());
  return { address: encodeAddress({ masterPublicKey, viewingPublicKey: viewing.pubkey }) as string, masterPublicKey, viewing, spending };
};

const vectors: Record<string, unknown>[] = [];
const run = async (name: string, device: MockDevice, consumed: string[], m: string, p: unknown) => {
  const start = consumed.length;
  const request = { id: vectors.length + 1, m, p };
  const response = await device.handle(request);
  vectors.push({ name, request, response, randomStream: consumed.slice(start), trace: m === 'railgunClearSign' ? device.trace : undefined });
  return response;
};

WalletInfo.setWalletSource('canon');
const { rng, consumed } = streamRng('canon-hw-vectors-v1');
const device = new MockDevice(MNEMONIC, { rng });
const path = "m/44'/60'/0'/0/0";
const main = HDNodeWallet.fromPhrase(MNEMONIC, undefined, path);

// --- secp256k1 messages -------------------------------------------------------
const info = await run('info', device, consumed, 'info', {});
check((info.r as { hasSeed: boolean }).hasSeed === true, 'info');
const addrs = await run('getAddresses', device, consumed, 'getAddresses', { paths: [path, "m/44'/60'/1984'/7702'/0'/12345'/0'"] });
check((addrs.r as { addresses: string[] }).addresses[0] === main.address, 'getAddresses: Main matches ethers');
const vk1 = await run('vaultKey', device, consumed, 'vaultKey', {});
const vk2 = await device.handle({ id: 0, m: 'vaultKey' });
const vsig = (vk1.r as { signature: string }).signature;
check(vsig === (vk2.r as { signature: string }).signature && verifyMessage(VAULT_MESSAGE, vsig) === main.address, 'vaultKey: deterministic, signed by Main');
const msg = await run('signMessage', device, consumed, 'signMessage', { path, message: '0x68656c6c6f2050616e676f6c696e' });
check(verifyMessage(getBytes('0x68656c6c6f2050616e676f6c696e'), (msg.r as { signature: string }).signature) === main.address, 'signMessage recovers to Main');
const typedData = {
  domain: { name: 'Calibur', version: '1.0.0', chainId: 11155111, verifyingContract: main.address },
  types: { Mail: [{ name: 'to', type: 'address' }, { name: 'contents', type: 'string' }] },
  primaryType: 'Mail',
  message: { to: CALIBUR, contents: 'hello' },
};
const td = await run('signTypedData', device, consumed, 'signTypedData', { path, typedData });
check(verifyTypedData(typedData.domain, typedData.types, typedData.message, (td.r as { signature: string }).signature) === main.address, 'signTypedData recovers to Main');
const txp = { chainId: '11155111', nonce: '3', maxFeePerGas: '2000000000', maxPriorityFeePerGas: '1000000000', gas: '21000', to: CALIBUR, value: '1000', data: '0x' };
const txr = await run('signTransaction', device, consumed, 'signTransaction', { path, tx: txp });
{
  const s = txr.r as { signature: { r: string; s: string; yParity: number } };
  const tx = Transaction.from({ type: 2, chainId: 11155111n, nonce: 3, maxFeePerGas: 2000000000n, maxPriorityFeePerGas: 1000000000n, gasLimit: 21000n, to: CALIBUR, value: 1000n, data: '0x' });
  check(recoverAddress(tx.unsignedHash, s.signature) === main.address, 'signTransaction recovers to Main');
}
const auth = await run('signAuthorization', device, consumed, 'signAuthorization', { path, chainId: '11155111', address: CALIBUR, nonce: '0' });
{
  const a = auth.r as { r: string; s: string; yParity: number };
  check(verifyAuthorization({ address: CALIBUR, chainId: 11155111n, nonce: 0n }, a) === main.address, 'signAuthorization (Calibur) recovers to Main');
}
const bad = await device.handle({ id: 99, m: 'signAuthorization', p: { path, chainId: '1', address: '0x1111111111111111111111111111111111111111', nonce: '0' } });
check(bad.e?.code === 4001, 'signAuthorization refuses anything but Calibur');

// --- RAILGUN keys -------------------------------------------------------------
const sender = await railgunAddress(MNEMONIC);
const svk = await run('getViewingKey', device, consumed, 'getViewingKey', { account: 0 });
check(typeof (svk.r as { shareableViewingKey: string }).shareableViewingKey === 'string', 'getViewingKey returns a shareable viewing key');
const walletFile = new URL('../../extension/.cache/sepolia/wallet.json', import.meta.url).pathname;
if (existsSync(walletFile)) {
  const w = JSON.parse(readFileSync(walletFile, 'utf8')) as { phrase: string; zk?: string };
  if (w.zk) check((await railgunAddress(w.phrase)).address === w.zk, 'RAILGUN derivation matches the Sepolia test wallet 0zk');
}

// --- Clear-sign, checked by the engine's verifier ------------------------------
const recipient = await railgunAddress(RECIPIENT_MNEMONIC);
const tokenData = getTokenDataERC20(WETH);
const senderAddressData = { masterPublicKey: sender.masterPublicKey, viewingPublicKey: sender.viewing.pubkey };

const clearSignCase = async (name: string, withUnshield: boolean) => {
  const unshieldTo = '0x1111111111111111111111111111111111111111';
  const request: ClearSignRequest = {
    account: 0,
    walletSource: 'canon',
    merkleRoot: '0x0abc0000000000000000000000000000000000000000000000000000000000ff',
    nullifiers: ['0x01', '0x02'].map((x) => `0x${x.slice(2).padStart(64, '0')}`),
    boundParams: { treeNumber: 0, minGasPrice: '1000000000', unshield: withUnshield, chainId: '11155111' },
    outputs: [
      { kind: 'change', tokenHash: TOKEN_HASH, value: '5000' },
      ...(withUnshield
        ? [{ kind: 'unshield' as const, recipientAddress: unshieldTo, tokenHash: TOKEN_HASH, value: '7000' }]
        : [{ kind: 'transfer' as const, recipient0zk: recipient.address, tokenHash: TOKEN_HASH, value: '7000', outputType: OutputType.Transfer as number }]),
    ],
  };
  const res = await run(name, device, consumed, 'railgunClearSign', { request });
  const out = res.r as { signature: { R8: [string, string]; S: string }; msgHash: string; outputs: { kind: string; response: string }[] };
  if (!out) {
    check(false, `${name}: device error ${JSON.stringify(res.e)}`);
    return;
  }
  const rebuiltCiphertexts: unknown[] = [];
  const commitments: bigint[] = [];
  for (const [i, o] of out.outputs.entries()) {
    const b = getBytes(o.response);
    if (o.kind === 'unshield') {
      const note = new UnshieldNote(unshieldTo, 7000n, tokenData);
      verify.verifyClearSignUnshieldOutput(note, { kind: 'unshield', commitment: b });
      commitments.push(BigInt(ByteUtils.hexlify(b, true)));
      check(true, `${name}: unshield output ${i} accepted by the engine`);
      continue;
    }
    const decoded = {
      kind: o.kind,
      random: b.slice(0, 16),
      senderBlindingKey: b.slice(16, 48),
      recipientBlindingKey: b.slice(48, 80),
      iv: b.slice(80, 96),
      tag: b.slice(96, 112),
      ciphertext: b.slice(112, 208),
      senderRandom: b.slice(208, 223),
      ...(o.kind === 'transfer' ? { annotationIv: b.slice(223, 239) } : {}),
    };
    const receiver = o.kind === 'change' ? senderAddressData : { masterPublicKey: recipient.masterPublicKey, viewingPublicKey: recipient.viewing.pubkey };
    const approved = TransactNote.createTransfer(receiver, senderAddressData, o.kind === 'change' ? 5000n : 7000n, tokenData, o.kind === 'change', o.kind === 'change' ? OutputType.Change : OutputType.Transfer, undefined);
    const note = TransactNote.withExternalRandomness(approved, ByteUtils.fastBytesToHex(decoded.random), ByteUtils.fastBytesToHex(decoded.senderRandom));
    try {
      const v = await verify.verifyClearSignNoteOutput(note, decoded, { privateKey: sender.viewing.privateKey, pubkey: sender.viewing.pubkey }, sender.masterPublicKey);
      rebuiltCiphertexts.push(v.commitmentCiphertext);
      commitments.push(v.hash);
      check(true, `${name}: ${o.kind} output ${i} accepted by the engine (blinding, GCM, plaintext, commitment)`);
    } catch (e) {
      check(false, `${name}: ${o.kind} output ${i}: ${(e as Error).message}`);
    }
  }
  const boundParamsHash: bigint = hashBoundParamsV2({
    treeNumber: 0n,
    minGasPrice: 1000000000n,
    unshield: withUnshield ? constants.UnshieldFlag.UNSHIELD : constants.UnshieldFlag.NO_UNSHIELD,
    chainID: 11155111n,
    adaptContract: '0x0000000000000000000000000000000000000000',
    adaptParams: `0x${'00'.repeat(32)}`,
    commitmentCiphertext: rebuiltCiphertexts,
  });
  try {
    verify.assertDeviceSignature(
      { merkleRoot: BigInt(request.merkleRoot), boundParamsHash, nullifiers: request.nullifiers.map((x) => BigInt(x)), commitmentsOut: commitments },
      sender.spending.pubkey,
      { msgHash: getBytes(out.msgHash), signature: { R8: [BigInt(out.signature.R8[0]), BigInt(out.signature.R8[1])], S: BigInt(out.signature.S) } },
    );
    check(true, `${name}: msgHash and EdDSA signature accepted by the engine`);
  } catch (e) {
    check(false, `${name}: ${(e as Error).message}`);
  }
};
await clearSignCase('railgunClearSign transfer + change', false);
await clearSignCase('railgunClearSign unshield + change', true);

// --- Frames --------------------------------------------------------------------
const frame = encodeFrame({ id: 1, m: 'info' });
const reader = new FrameReader();
const parsed = [...reader.push(new Uint8Array([0x41, 0x42, ...frame.slice(0, 5)])), ...reader.push(frame.slice(5))];
check(parsed.length === 1 && (parsed[0] as { m: string }).m === 'info', 'frame codec: skips noise, reassembles split frames');
{
  // Log lines and a corrupted frame around a good one, as on the shared USB port.
  const enc = new TextEncoder();
  const good = encodeFrame({ id: 7, r: { ok: true } });
  const broken = encodeFrame({ id: 6, r: { ok: false } });
  broken[broken.length - 1] ^= 0xff;
  const r2 = new FrameReader();
  const stream = new Uint8Array([...enc.encode('I (1234) wallet: boot\n@@ ok\n'), ...broken, ...enc.encode('W (1240) ble: adv\n'), ...good]);
  const got = [...r2.push(stream.slice(0, 40)), ...r2.push(stream.slice(40))];
  check(got.length === 1 && (got[0] as { id: number }).id === 7, 'frame codec: skips log lines, drops a bad CRC, keeps the next frame');
}

if (WRITE) {
  mkdirSync(OUT, { recursive: true });
  const bigintSafe = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
  writeFileSync(
    `${OUT}README.md`,
    [
      '# Canon hardware-wallet test vectors',
      '',
      'Written by `bun src/selftest.ts --write` in apps/hw-mock. Each file is one request the device must answer byte for byte.',
      '',
      `- Seed: \`${MNEMONIC}\` (BIP-39, no passphrase)`,
      '- `randomStream`: the bytes the device\'s RNG must return, in order, for that request (hex, one entry per draw: 16-byte note random, 15-byte sender random, 16-byte GCM IV, 16-byte annotation IV, …).',
      '- `request` / `response`: the JSON inside the frames. `frameHex` is the full request frame.',
      '- `trace` (clear-sign only): intermediate values: sender master public key, per-output randomness, shared key, note public key, commitment, and the bound-params hash.',
      '- Every clear-sign response here passed the RAILGUN engine\'s own verifier (`transaction/clear-sign-verify.js`).',
      '',
    ].join('\n'),
  );
  for (const v of vectors) {
    const file = `${OUT}${String(v.name).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
    writeFileSync(file, JSON.stringify({ seed: MNEMONIC, ...v, frameHex: Buffer.from(encodeFrame(v.request as never)).toString('hex') }, bigintSafe, 2));
  }
  console.log(`wrote ${vectors.length} vectors to ${OUT}`);
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);

export { hashMessage, TypedDataEncoder, poseidon };
