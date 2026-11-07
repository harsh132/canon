# Onboarding

First install opens `onboard.html` in its own tab. The toolbar popup and the side panel show the same screens when no wallet exists. Once the wallet exists, the tab says to open Canon from the toolbar.

| Choice | What happens | Unlock |
|---|---|---|
| New wallet | Password twice, then the 12-word phrase once, then three of its words back | Password |
| Passkey | Create a passkey, or use one that exists. The phrase backup that follows is optional | The passkey |
| Restore | A 12- or 24-word grid. Pasting a phrase into any box fills the boxes from there on. Words not on the BIP-39 list turn red and hold back the password step | Password |

Hardware wallets will be a fourth choice. Hardware devices cannot hold RAILGUN's keys, so the likely route derives the RAILGUN wallet from a fixed signature made on the device.

## Passkey wallets

The passkey is the wallet. Code: `src/popup/passkey.ts` (WebAuthn) and `core/vault.ts` (keys).

1. The visible page runs WebAuthn. The core is an offscreen document and can show no dialog.
2. The relying party is the extension itself (`chrome-extension://nigpkikilgbfgmgcmeiidiinikafjpjg`). The manifest key pins that id, so the passkey survives updates.
3. The PRF extension is evaluated with the fixed salt `canon wallet v1`. It returns the same 32 bytes every time this passkey is used, on any device it syncs to.
4. The core runs HKDF-SHA256 over those bytes (salt `canon`):
   - info `canon/wallet/v1`, 16 bytes: the entropy of a 12-word phrase. Everything else, Main, site addresses and RAILGUN keys, comes from that phrase as usual.
   - info `canon/vault/v1`, 96 bytes: the vault key, the RAILGUN encryption key and the book key, in place of the password stretch.
5. The vault record stores `kind: 'passkey'` and the credential id, so unlock asks for that passkey.

"Use existing passkey" asks for any Canon passkey with no credential id, so a passkey synced from another device restores the same wallet and rescans.

### Risks

- **Deleting the passkey loses the wallet**, unless the phrase was written down at setup.
- **Whoever controls the passkey's sync account controls the wallet.** That is Google Password Manager, iCloud Keychain, or the security key itself.
- **PRF support varies.** Google Password Manager, iCloud Keychain and most FIDO2 security keys support it. A provider without it gets "This passkey can't hold a wallet".
- **The passkey belongs to this extension id, in Chrome.** It will not work in another browser's build of Canon.
- **The toolbar popup may close while the passkey dialog has focus.** The side panel and the onboarding tab stay open.

## Verified

`scripts/e2e-onboard.mjs` drives all three paths in one profile, with a CDP virtual authenticator that supports PRF. Real authenticators (Google Password Manager, iCloud, a security key) are not testable headless and are still to be tried by hand.
