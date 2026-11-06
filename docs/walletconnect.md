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
- **First contact gets a fresh address.** The next unused HD index, labelled with the dapp's name. The user can pick an existing address instead.
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

Create a project at cloud.reown.com, allow that origin, and set `PANGOLIN_WC_PROJECT_ID` in `apps/extension/.env`.

The dev `.env` currently borrows zo.mr's project id, which allows only zo.mr. The relay never connects from the extension, and after 20 s the Apps screen shows "Relay refused". The same code pairs in about one second under Node, which sends no origin.

## Analytics

WalletKit posts events to `pulse.walletconnect.org` even with `telemetryEnabled: false`. The core's fetch patch answers those requests itself with an empty 204.
