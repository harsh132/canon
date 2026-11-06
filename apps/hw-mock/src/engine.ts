// The RAILGUN engine's internals, loaded by file path: its package exports map
// only exposes the index, and the mock must use exactly the engine's own code.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(require.resolve('@railgun-community/engine')), '..');
const load = <T>(path: string): T => require(join(root, 'dist', path)) as T;

/* eslint-disable @typescript-eslint/no-explicit-any */
export const keys = load<any>('utils/keys-utils.js');
export const { AES } = load<any>('utils/encryption/aes.js');
export const { poseidon } = load<any>('utils/poseidon.js');
export const { hashBoundParamsV2 } = load<any>('transaction/bound-params.js');
export const { Memo } = load<any>('note/memo.js');
export const { deriveNodes, WalletNode } = load<any>('key-derivation/wallet-node.js');
export const { decodeAddress, encodeAddress } = load<any>('key-derivation/bech32.js');
export const { Babyjubjub } = load<any>('key-derivation/babyjubjub.js');
export const { ByteUtils, ByteLength } = load<any>('utils/bytes.js');
export const { TransactNote } = load<any>('note/transact-note.js');
export const constants = load<any>('models/transaction-constants.js');
export const verify = load<any>('transaction/clear-sign-verify.js');
export const clearSign = load<any>('wallet/clear-sign.js');
export const { eddsa } = require('@railgun-community/circomlibjs');
export const msgpack = require('msgpack-lite');
