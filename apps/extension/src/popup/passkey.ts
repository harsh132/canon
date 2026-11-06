// WebAuthn runs in the visible page (the core is an offscreen document and can
// show no dialog). The relying party is the extension itself, pinned by the
// manifest key, so the passkey keeps working across updates.
//
// PRF with a fixed salt gives the same 32 bytes every time this passkey is used,
// on any device it syncs to. That output is the wallet (core/vault.ts).

const SALT = new TextEncoder().encode('pangolin wallet v1');
const NO_PRF = "This passkey can't hold a wallet. Try Google Password Manager, iCloud Keychain or a security key.";

const hex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const b64url = (b: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };

const friendly = (e: unknown): Error => {
  const name = (e as DOMException)?.name;
  if (name === 'NotAllowedError') return new Error('Passkey cancelled');
  if (name === 'InvalidStateError') return new Error('A passkey for Pangolin already exists here');
  return e instanceof Error ? e : new Error(String(e));
};

/** Ask for an existing passkey; with no id, any Pangolin passkey on this device or synced to it. */
export const getPasskey = async (credentialId?: string | null): Promise<{ prf: string; credentialId: string }> => {
  let cred: PublicKeyCredential;
  try {
    cred = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        userVerification: 'required',
        allowCredentials: credentialId ? [{ type: 'public-key', id: unb64url(credentialId) }] : [],
        extensions: { prf: { eval: { first: SALT } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential;
  } catch (e) {
    throw friendly(e);
  }
  const first = (cred.getClientExtensionResults() as PrfResults).prf?.results?.first;
  if (!first) throw new Error(NO_PRF);
  return { prf: hex(first), credentialId: b64url(cred.rawId) };
};

/** Make a new passkey for a new wallet. */
export const createPasskey = async (): Promise<{ prf: string; credentialId: string }> => {
  let cred: PublicKeyCredential;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        rp: { name: 'Pangolin' },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'Pangolin wallet', displayName: 'Pangolin wallet' },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        extensions: { prf: { eval: { first: SALT } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential;
  } catch (e) {
    throw friendly(e);
  }
  const ext = cred.getClientExtensionResults() as PrfResults;
  const credentialId = b64url(cred.rawId);
  if (ext.prf?.results?.first) return { prf: hex(ext.prf.results.first), credentialId };
  // Some authenticators enable PRF at creation but only evaluate it on use.
  if (ext.prf?.enabled === false) throw new Error(NO_PRF);
  return getPasskey(credentialId);
};
