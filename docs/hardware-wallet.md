# Hardware wallet

Pangolin with an ESP32-S3 running BuddyOS as the signer. The device holds the seed. The browser holds only what it must: RAILGUN's viewing key (to find notes and build proofs) and public addresses.

Status (2026-11-07):

| Part | State |
|---|---|
| Reference device and vectors (`apps/hw-mock`) | Done. `bun src/selftest.ts`: every secp256k1 message recovers, RAILGUN derivation matches a known 0zk, the engine's clear-sign verifier accepts every output and signature |
| BuddyOS firmware (`~/Work/BuddyOS`, `components/wallet_core`, `components/app_wallet`) | C core reproduces all 10 vectors byte for byte on the host. Not yet flashed: waiting for the board on USB |
| Bluetooth link (both sides) | In progress |
| Pangolin: device link, signer, RAILGUN hardware wallet, onboarding, unlock, confirm banner | Done. `scripts/e2e-hardware.mjs` against the mock: all 13 checks pass, with a fresh seed each run |
| A private send clear-signed end to end (real proof) | Not run: needs private funds on a device seed |
| Gasless 7702 call signed on the device through the hosted sponsor | Done on Sepolia: Calibur batch and authorization signed on the mock device, sent by the Cloudflare sponsor in 14 s ([tx](https://sepolia.etherscan.io/tx/0x2e45d5be89ea22d1a600fc845970bfb954573689927ebd88f3a18e6143d39eda)) | Device app in `~/Work/BuddyOS` (`components/app_wallet`), Pangolin side in this repo.

## Who holds what

| Key | Where | Used for |
|---|---|---|
| BIP-39 seed | Device only, PIN-encrypted | Everything below |
| secp256k1 keys (Main, site addresses) | Device | Messages, typed data, transactions, 7702 authorizations |
| RAILGUN spending key (BabyJubJub) | Device | Clear-signing private transactions |
| RAILGUN viewing key (Ed25519) | Device, shared with the browser once | Scanning notes, nullifiers, proofs |
| Vault key | Derived in the browser from a device signature | Encrypting Pangolin's local vault and book |

Nothing that can spend leaves the device. A stolen browser profile can see the private balance (the viewing key) but cannot move anything.

## Transport

Two links carry the same frames. Pangolin remembers which one the user picked (`localStorage['pangolin.hwLink']`: `ble` or `usb`) and the user can switch on the unlock screen.

### Bluetooth (BLE)

A GATT service next to Buddy's keyboard service:

| | UUID | Properties |
|---|---|---|
| Service | `3dff3ba4-599b-4084-b915-020fd7c35f03` | |
| Requests (PC to device) | `3dff3ba5-599b-4084-b915-020fd7c35f03` | Write (with response), max length 512 |
| Responses (device to PC) | `3dff3ba6-599b-4084-b915-020fd7c35f03` | Notify |

- **Security.** Both characteristics and the notify descriptor need an encrypted, authenticated link (`ESP_GATT_PERM_*_ENC_MITM`): a bonded host paired with LE Secure Connections and numeric comparison confirmed on Buddy. Frames carry the vault key signature and the viewing key, so an unpaired link must never reach them.
- **Chunks.** Pangolin writes each frame in pieces of at most 180 bytes, in order, each acknowledged. The device appends the pieces to one byte stream and pulls frames out with the same reader as USB. It sends responses as notifications of at most MTU − 3 bytes, in order, waiting out congestion. Buddy sets its local MTU to 517.
- **One link per request.** The reply goes back on the link the request came in on. A dropped link discards a half-received frame.
- **No logs** on BLE.
- **Finding Buddy.** Pangolin's picker filters on the service UUID or the name `Buddy`, so the service UUID can sit in the scan response. Buddy only advertises to bonded hosts, so pair the PC first (Buddy's Bluetooth settings, then the OS's Bluetooth settings).
- **Pairing on Linux** needs a BlueZ agent that can show a code. Without one, numeric comparison fails with "No agent available for request type 2". Pair from an interactive `bluetoothctl` (it registers its own agent): `scan on`, `pair <Buddy's address>`, confirm the code on both sides, `trust <address>`.
- **Chrome flags** (checked on Chromium 155 on Linux, in the extension's offscreen core):
  - `#enable-web-bluetooth`: Web Bluetooth itself. Linux only; Windows and macOS have it on.
  - `#enable-web-bluetooth-new-permissions-backend`: `navigator.bluetooth.getDevices()` and `watchAdvertisements()`, which the core (no user gesture) uses to reconnect to the device picked in a Pangolin page. Needed on every platform.
  - `#enable-web-bluetooth-confirm-pairing-support`: lets Chrome itself confirm the pairing code, instead of pairing in `bluetoothctl` first. Optional.
  - `#enable-experimental-web-platform-features` turns on the first two as well.

### USB

USB serial (CDC-ACM, `303a:1001`) through Chrome's Web Serial. The user picks the device once in a Pangolin tab (`navigator.serial.requestPort` needs a click); the grant belongs to the extension's origin, so the core (offscreen document) reopens it with `getPorts()`. Right after `open()`, call `setSignals({ dataTerminalReady: false, requestToSend: false })`, or the board resets.

The device's log lines may share this port; the frame reader skips them.

### Frames

```
0x02 'P' 'W' 0x01 | length u32 LE | JSON (UTF-8) | CRC32 u32 LE of the JSON
```

Every request has a numeric `id`; the response repeats it. One request at a time.

```json
{"id":7,"m":"signMessage","p":{"path":"m/44'/60'/0'/0/0","message":"0x68656c6c6f"}}
{"id":7,"r":{"signature":"0x…65 bytes"}}
{"id":7,"e":{"code":4001,"message":"Rejected on device"}}
```

| Error code | Meaning |
|---|---|
| 4001 | Rejected on the device |
| 4100 | Locked: enter the PIN on the device |
| 4200 | Not supported |
| -32602 | Bad parameters (the device refused before showing anything) |

All byte values are `0x`-prefixed hex strings. Integers that can exceed 2^53 are decimal strings.

## Messages

Every message that signs shows a confirm screen. Hold PWR to approve; swipe up to reject.

| `m` | Params | Device shows | Result |
|---|---|---|---|
| `info` | — | — | `{fw, hasSeed, locked}` |
| `getAddresses` | `{paths: string[]}` | "Share addresses with Pangolin?" once per session | `{addresses: string[]}` |
| `vaultKey` | — | "Unlock Pangolin" | `{signature}`: secp256k1 signature on `m/44'/60'/0'/0/0` of the fixed message `Pangolin vault key v1`, RFC 6979 (same every time) |
| `getViewingKey` | `{account: 0}` | "Let Pangolin see your private balance" | `{shareableViewingKey}` in RAILGUN's format (engine `AbstractWallet.generateShareableViewingKey`) |
| `signMessage` | `{path, message}` | The message as text if UTF-8, else hex | `{signature}` (EIP-191) |
| `signTypedData` | `{path, typedData}` (EIP-712 JSON) | Domain name and chain, primary type, top-level fields | `{signature}`; the device computes the hash |
| `signTransaction` | `{path, tx}` (type 2: chainId, nonce, maxFeePerGas, maxPriorityFeePerGas, gas, to, value, data) | Network, recipient, value, function selector | `{signature}` (y, r, s) |
| `signAuthorization` | `{path, chainId, address, nonce}` | "Turn this address into a smart account" | `{r, s, yParity}`. Refused unless `address` is Calibur `0x000000009B1D0aF20D8C6d0A44e162d11F9b8f00` |
| `railgunClearSign` | `{request}` (below) | Each output: kind, recipient, token, amount; the fee | `{signature: {R8: [x, y], S}, msgHash, outputs: [{kind, response}]}` |

## Clear-signing private transactions

The request and response match RAILGUN's Ledger clear-sign contract (`@railgun-community/ledger-client` 0.4, engine `wallet/clear-sign.js`), so the engine's `HardwareWallet` uses the device through a small connector.

Request:

```ts
{
  account: 0,
  merkleRoot: hex32,
  nullifiers: hex32[],               // 1..4
  boundParams: { treeNumber, minGasPrice, unshield, chainId, adaptContract?: hex20, adaptParams?: hex32 },
  outputs: (                          // 1..3, n + m <= 5
    | { kind: 'transfer', recipient0zk, tokenHash: hex32, value, outputType?, memo?: hex<=32 }
    | { kind: 'change', tokenHash, value }
    | { kind: 'broadcaster', recipientMasterPublicKey: hex32, recipientViewingPublicKey: hex32, tokenHash, value }
    | { kind: 'unshield', recipientAddress: hex20, tokenHash, value }
  )[]
}
```

`tokenHash` is 12 zero bytes followed by the 20-byte ERC-20 address.

Pangolin adds one field to the Ledger contract: `walletSource` (string, `pangolin`). The device folds it into each transfer's encrypted annotation, which the engine rebuilds with the same value; a different source changes the bound-params hash and the engine rejects the signature.

The device returns `senderRandom` for every note output. Pangolin's mock uses 15 random bytes for transfers and `MEMO_SENDER_RANDOM_NULL` (15 zero bytes) for change and broadcaster outputs; the engine accepts whatever the device returns.

For each output the device picks the note randomness, computes the note public key and commitment, and encrypts the note to the recipient. Response bytes per output:

```
transfer     random(16) | senderBlinding(32) | recipientBlinding(32) | iv(16) | tag(16) | ciphertext(96) | senderRandom(15) | annotationIv(16)   = 239
change       … same 208-byte tuple … | senderRandom(15)                                                                                       = 223
broadcaster  … same as change                                                                                                            = 223
unshield     commitment(32)                                                                                                             = 32
```

Then it builds the bound params (with its ciphertexts), hashes them, computes `msgHash = poseidon(merkleRoot, boundParamsHash, ...nullifiers, ...commitmentsOut)` and signs it with EdDSA-Poseidon on BabyJubJub using the spending key.

The engine (`transaction/clear-sign-verify.js`) recomputes every commitment and ciphertext from the device's randomness, checks `msgHash`, and verifies the signature against the wallet's spending public key before proving. A wrong byte fails loudly there, not on chain.

**Reference implementation and test vectors.** `apps/hw-mock` in this repo is a JavaScript device built from the engine's own primitives (`TransactNote`, `getNoteBlindingKeys`, AES-GCM, Poseidon, `signEDDSA`). It speaks the frame protocol over a WebSocket for tests, and writes `vectors/*.json`: fixed seed, fixed randomness, request, expected response. The firmware must reproduce those bytes exactly.

**Device crypto:**
- trezor-crypto: secp256k1 with recovery, BIP-32/39, Keccak-256, Ed25519/X25519, PBKDF2.
- Ported to C: BabyJubJub, Poseidon (circomlib constants), EdDSA-Poseidon.
- mbedtls: AES-256-GCM.
- RAILGUN key derivation must match the engine (`key-derivation/`): spending `m/44'/1984'/0'/0'/i'`, viewing `m/420'/1984'/0'/0'/i'`. The same seed then gives the same 0zk address as any RAILGUN wallet.

**Limits:**
- Inputs 1–4, outputs 1–3, at most 5 in total.
- Memo at most 32 bytes.
- No blind signing: Pangolin sets the engine's clear-sign mode to `require`. A transaction too large to clear-sign is split, or refused.

## Pangolin side

- **Onboarding:** "Hardware wallet" is the fourth choice. "Connect with Bluetooth" or "Connect with USB" picks the device, then `getViewingKey` and `vaultKey`, confirmed on the device.
- **Unlock:** "Unlock with device" uses the remembered link; "Use USB instead" / "Use Bluetooth instead" switches it (the core drops the old link).
- **Vault:** kind `hardware`. Vault keys come from HKDF over the `vaultKey` signature, as with a passkey's PRF output. Unlocking asks the device for `vaultKey` again. It stores the viewing key, never a seed.
- **RAILGUN:** `createHardwareRailgunWallet` from the shareable viewing key, with a connector that sends `railgunClearSign`.
- **Public accounts:** signers that forward to the device. Every approve in Pangolin is followed by "Confirm on device".

**Not yet:**
- Unshielding to ETH through RelayAdapt7702, the WETH-to-ETH path on Sepolia, needs the device to hold 7702 ephemeral keys (the engine's ephemeral signer provider). Until then, hardware wallets unshield WETH as WETH.
- Gasless 7702 site calls work, since they are Calibur typed data plus a Calibur authorization, both signed on the device.

## Device security (BuddyOS)

- **Wallet builds:**
  - compile out the USB test console, which can tap the screen;
  - turn off Wi-Fi updates and HTTP servers while unlocked;
  - generate the seed on the device and show it once.
- **Seed storage:** encrypted under the PIN, using PBKDF2 with the ESP32-S3's HMAC eFuse key. Wiped after repeated wrong PINs. Keys are zeroed after use.
- **Secure boot and flash encryption** are permanent eFuse burns: the owner's choice, on a spare board first.
- **No secure element and no glitch hardening.** Hobby grade; say so to users.
