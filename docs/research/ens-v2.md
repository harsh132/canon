# POC findings: sponsored ENSv2 subnames for the privacy wallet (2026-11-06)

Target: ENS "Best Use of ENSv2" ($7k, Sepolia allowed, ENSv2 must be central). Script: `14-ens-sponsored-subname.mjs`,
run against `anvil --fork-url <sepolia> --fork-block-number <head-12>`. All 12 checks pass.

## What the script proves

1. **Parent** `<parent>.eth` registered through the real ENSv2 `.eth` registrar (commit, wait 60 s, register),
   paid in Circle Sepolia USDC, with a fresh **UserRegistry** (VerifiableFactory proxy) as its subregistry.
   In that subregistry the sponsor holds only `ROLE_REGISTRAR | ROLE_RENEW` on the root. No upgrade, no
   unregister, no set-resolver or set-subregistry over anyone's name.
2. **Per user, sponsor pays everything; the user's identity address never holds a wei:**
   - deploys the user's own **PermissionedResolver** (VerifiableFactory proxy) with the sponsor as temporary admin;
   - one `multicall`: `setText(name, "org.railgun.0zk", 0zk…)`, `grantSetterRoles(setText(name, key), device)`,
     `grantRootRoles(ALL, identity)`, `revokeRootRoles(ALL, sponsor)`;
   - `UserRegistry.register(label, identity, 0, resolver, userRoles, expiry = 2^64-1)` (never expires).
3. **Resolution** through `UniversalResolverV2` **and** the public `UpgradableUniversalResolverProxy`
   (`0xeEeE…EeEe`, what wallets call) returns the 0zk address. ✓
4. **Renounce**: `ETHRegistry.revokeRoles(parent, SET_SUBREGISTRY | SET_SUBREGISTRY_ADMIN, sponsor)`.
   Then every hijack attempt reverts with `EACUnauthorizedAccountRoles` (or `LabelAlreadyRegistered`):
   swap parent subregistry, unregister user, repoint user's resolver, re-register label, upgrade the
   subregistry, upgrade the user's resolver, rewrite the 0zk record.
5. **Device key**: can rotate *only* the `org.railgun.0zk` text record; a different text key and the ETH
   address record both revert. The unfunded identity keeps full control (rewrite records, repoint
   resolver, upgrade its resolver), all verified by simulation from its address.

Gas paid by the sponsor: **parent setup ≈ 1.95M once, ≈ 2.58M per user** (resolver proxy 0.79M, multicall
1.18M, register 0.61M).

## The live Sepolia deployment (use these, not contracts-v2 main)

Public resolution path: `0xeEeE…EeEe` → `ManagedUniversalResolverProxy 0x6d80…e6F1` → `UniversalResolverV2 0x24e1…2d72`
→ `RootRegistry 0xb458…c43f`. That is the address set in docs.ens.domains/learn/deployments. The contracts-v2
repo's `deployments/sepolia` and `deployments/sepolia-official-v1-20260525-r2` folders are **two other, unused
deployments**; don't mix their addresses.

The live contracts are an older release than contracts-v2 `main`. Verified ABIs are saved in `poc/abi/` (from
Sourcify). Differences that bit us:

| | live (Sepolia) | contracts-v2 main |
|---|---|---|
| `UserRegistry.initialize` | `initialize((address account, uint256 roleBitmap)[] grants)` | `initialize(address, uint256)` |
| `PermissionedResolver.initialize` | `initialize(grants[], bytes[] calls)` | `initialize(address, uint256, bytes[])` |
| text setter | `setText(bytes dnsName, string key, string value)` | `setText(bytes32 node, …)` |
| key-scoped grant | `grantSetterRoles(bytes setterCalldata, address)`; scope = key, **not** per name | `authorizeTextRoles(name, key, account, grant)` per name+key |
| reading | only `resolve(dnsName, abi(text(node,key)))` | also `text(node,key)` |
| resolver role bits | ADDRESS 0, TEXT 4, CONTENTHASH 8, ABI 12, INTERFACE 16, NAME 20, DATA 24, LINK 28, CAN_NAME 120, UPGRADE 124 | different set |

Key-only scoping is fine for us: every user has their own resolver serving one name.

## Gotchas

- **Payment token is Circle Sepolia USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`** (no public mint; Circle
  faucet). MockUSDC/MockDAI from the repo's deployment folders are not accepted (`isPaymentToken = false`).
  Price for a 13-char label: 8 USDC/year, 45 USDC/10 years.
- **Don't use anvil's default account #0 as the name owner on a Sepolia fork.** On public Sepolia that shared key
  has EIP-7702 delegated code without `onERC1155Received`, so minting the ERC-1155 name token to it reverts with
  `ERC1155InvalidReceiver`. Use a fresh key.
- Parent owners get only `SET_SUBREGISTRY`, `SET_RESOLVER` (each + admin) and `CAN_TRANSFER_ADMIN`; no unregister.
  So one revocation removes the "swap the whole namespace" power.
- Load-balanced public RPCs can make anvil fail with "block not found" at the fork tip; pin `--fork-block-number head-12`.

## Trust left after renouncing (state these in the README's CROPS section)

- **New sign-ups depend on us**: the sponsor still holds `ROLE_REGISTRAR`, so it can refuse or squat *new* labels.
  It cannot touch any issued name.
- **Parent expiry**: the parent is registered for N years. Anyone can renew it through `ETHRegistrar.renew` (pays
  USDC), but if nobody does, after the grace period someone else could register the parent with a different
  subregistry and capture every subname. Mitigation: register for 10 years; show "renew the namespace" in the UI.
- **Device key needs gas** to rotate its record. The identity address stays unfunded; the device key would be
  funded by the sponsor or a relayer. Open question.
- Text key `org.railgun.0zk` is our choice (ENSIP-5 reverse-DNS style), not a standard.
- Subname labels are public; issued names all point at per-user resolvers, which are linkable to their names (by design).

## Next

- Same flow on real Sepolia: sponsor key needs Sepolia ETH + 8 USDC from Circle's faucet.
- Wire into the extension: sign-up calls a small sponsor endpoint **through Anon-RPC's fetch** (the endpoint learns
  only what goes on-chain anyway: label, identity address, 0zk address); name lookups go through the Universal
  Resolver via Anon-RPC.
- Later: paid private purchase via a registrar contract holding `ROLE_REGISTRAR`, called from a Railgun
  cross-contract call (same primitive as the Uniswap private swap).
