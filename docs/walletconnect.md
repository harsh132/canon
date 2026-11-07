# WalletConnect and per-dapp addresses

| Item | Value |
|---|---|
| Packages | `@reown/walletkit` 1.6, `@walletconnect/core` 2.26 |
| Chain offered | `eip155:11155111` (Sepolia) only |
| Methods | `personal_sign`, `eth_signTypedData` (v1, v3, v4), `eth_sendTransaction` |
| Code | `apps/extension/src/core/wc.ts`, `dapp-origin.ts`, `book.ts` |

## Rules, from Ender

- **A dapp's identity is its full host.** `app.uniswap.org` and `uniswap.org` are two dapps. Non-default ports count. On IPFS path gateways the CID is part of the key. Merging two sites would hand them a shared address; splitting one only costs a duplicate.
- **Prefer the attested origin.** WalletConnect's Verify origin is used when present; the dapp's self-declared URL is the fallback, and the prompt says "self-declared".
- **First contact gets a fresh address** on RAILGUN's app path, `m/44'/60'/1984'/7702'/0'/<purpose(dapp)>'/0'` (see architecture.md), labelled with the dapp's name. The user can pick an existing address instead.
- **Reconnects get the same address.** The binding is never re-pointed. Disconnecting does not delete it.
- **Mint before approving.** The address is written to the book before the session exists, so a session never signs as an address the book lacks.
- **Nothing is auto-approved.** Proposals and requests open the popup.
- **EIP-7702 delegations are refused** without a prompt. A transaction with an `authorizationList` or type 4 gets error 4001.
- **Unsupported methods** get -32601. `eth_sign` is not offered.

Bindings live in the encrypted account book.

## Project id

The relay only accepts origins on the WalletConnect project's allowlist. The extension origin is fixed by the manifest key:

```
chrome-extension://nigpkikilgbfgmgcmeiidiinikafjpjg
```

Canon's own project allows it. The id is public config, kept in `apps/extension/.env` as `CANON_WC_PROJECT_ID`.

Verified 2026-11-06 with `e2e-wc.mjs`: two dapps got two fresh addresses, `personal_sign` recovered to dapp A's address, and A reconnecting got the same address back.

A project whose allowlist lacks the origin never connects; after 20 s the Apps screen shows "Relay refused".

## Analytics

WalletKit posts events to `pulse.walletconnect.org` even with `telemetryEnabled: false`. The core's fetch patch answers those requests itself with an empty 204.

## Dapp icons

Prompts and the Apps list show the dapp's icon, with the origin as the leading line beside it and the app's self-declared name underneath. The icon URL comes from the dapp's metadata, so the core fetches it through the transport (Nox when on), keeps only `https:` and `data:` images up to 256 KB, and hands the UI an inline `data:` URL (`core/icons.ts`). No icon falls back to the site's initials.

A phishing site can show any logo it likes; the origin line is what to check.
