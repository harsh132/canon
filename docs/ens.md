# ENS names

Every wallet can claim `<label>.pangolin.eth` for free. The name's `org.railgun` text record holds the wallet's 0zk, so anyone can pay it privately by name.

| Item | Value |
|---|---|
| Parent | `pangolin.eth` on the live ENSv2 Sepolia deployment, registered 2026-11-06 for 1 year (8 USDC) |
| Subregistry | `0x371c18e4B47B1183Ae4c4bE2018440871424bF61` (UserRegistry proxy) |
| Sponsor | `0x254d9B9c09F113271fBC2f7DD84f17060A7d3141`: REGISTRAR + RENEW on the subregistry, nothing else |
| Record key | `org.railgun` (ENSIP-5 style; same key as the Ender wallet) |
| Server | `apps/sponsor` (`bun src/server.ts`, port 8792) |
| Extension | `src/core/ens.ts`, Name screen, name chip on Home |

## What a claim writes

All gas is paid by the sponsor, in three transactions:

1. Deploy the user's own PermissionedResolver (VerifiableFactory proxy), sponsor as temporary admin.
2. One multicall: `setText(name, "org.railgun", 0zk)`, grant every resolver role to the owner, revoke every role from the sponsor.
3. `UserRegistry.register(label, owner, resolver, userRoles, expiry = never)`.

The **owner** is a fresh address on the app path with `pangolin.eth` as the app, `m/44'/60'/1984'/7702'/0'/<purpose(pangolin.eth)>'/0'`. It never holds funds and signs nothing else. Main is not used, because Main appears on-chain as the sender of shields.

## Trust after issue

Verified on Sepolia for `alice.pangolin.eth`: the sponsor's attempts to rewrite the record, unregister the name and repoint its resolver all revert with `EACUnauthorizedAccountRoles`. The sponsor also renounced `SET_SUBREGISTRY` on `pangolin.eth`, so it cannot swap the whole namespace.

What the sponsor still controls:

- **New names.** It can refuse or squat labels not yet issued.
- **Parent expiry.** `pangolin.eth` is registered for one year. Anyone can renew it through the registrar; if nobody does, someone could register the parent again after the grace period and capture every subname.

## Paying a name

Send accepts a name. It is resolved only when the user taps Review, never per keystroke, because each lookup tells the RPC which name is being paid. Resolution goes through the public Universal Resolver (`0xeEeE…EeEe`) through Nox.

- If the name has an `org.railgun` record, the send goes to that 0zk: Make private from a public account, Send privately from the private balance.
- Otherwise its ETH address record, as a public send or Make public.
- The review shows the resolved address and which record it came from.

## Privacy of a claim

The sponsor learns the label, owner address and 0zk (all published on-chain anyway) and, unless it is reached through Nox, the user's IP. The extension sends HTTPS sponsor calls through Nox; the local development sponsor (`http://127.0.0.1:8792`) is called directly.

## Verified

`e2e-sepolia.mjs name`, 2026-11-06:

- Claimed `alice.pangolin.eth`; owner `0x81d7…f2C6` with 0 ETH.
- Paying `alice.pangolin.eth` from Main resolved through Nox to the wallet's 0zk via `org.railgun` and ran as Make private ([tx](https://sepolia.etherscan.io/tx/0xd0da0f458b05c311471ad0d4ab7588b10318fcdc6d7380031cec29509a103f42)).
- A claim whose reply was lost is adopted on retry, because the name already pays this wallet.
