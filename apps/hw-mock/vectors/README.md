# Pangolin hardware-wallet test vectors

Written by `bun src/selftest.ts --write` in apps/hw-mock. Each file is one request the device must answer byte for byte.

- Seed: `test test test test test test test test test test test junk` (BIP-39, no passphrase)
- `randomStream`: the bytes the device's RNG must return, in order, for that request (hex, one entry per draw: 16-byte note random, 15-byte sender random, 16-byte GCM IV, 16-byte annotation IV, …).
- `request` / `response`: the JSON inside the frames. `frameHex` is the full request frame.
- `trace` (clear-sign only): intermediate values: sender master public key, per-output randomness, shared key, note public key, commitment, and the bound-params hash.
- Every clear-sign response here passed the RAILGUN engine's own verifier (`transaction/clear-sign-verify.js`).
