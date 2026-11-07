# Sponsor

Canon's sponsor pays gas so that no address of the user's appears as a sender. Testnet only: it charges no fee, so hourly caps hold back abuse.

Hosted at **https://canon-sponsor.prakashharsh32.workers.dev** (Cloudflare Worker). The extension's production build points there through `CANON_SPONSOR_URL` in `apps/extension/.env`.

## Endpoints

| Path | Does | Code |
|---|---|---|
| `GET /health` | Parent name, subregistry, sponsor address | `src/app.ts` |
| `GET /available?label=` | Whether `<label>.canon.eth` is free | `src/app.ts` |
| `POST /claim` | Issues `<label>.canon.eth` to the user's identity address with an `org.railgun` record, then hands over every role | `src/app.ts` |
| `POST /relay` | Submits a proved RAILGUN transaction, or RAILGUN's 7702 unshield as type 4 | `src/relay.ts` |
| `POST /execute` | Submits a Calibur batch for an EIP-7702 site address, delegating on first use | `src/execute.ts` |

What each check refuses is in [site-accounts.md](site-accounts.md#what-the-sponsor-checks) and the code comments.

## How it runs

- **`src/app.ts`** is the whole API as one fetch handler, built from a config: key, RPC, subregistry, caps.
- **Local:** `bun src/server.ts` serves it on `127.0.0.1:8792`, reading `.env` and `.data/parent.json`.
- **Cloudflare:** `src/worker.ts` sends every request to one Durable Object (`Sponsor`), which builds the same app. One instance means one queue for the sponsor's single nonce and one set of caps. Built with Vite and the Cloudflare plugin, configured in `cloudflare.config.ts`.

| Cap per hour | Local | Hosted |
|---|---|---|
| Name claims | 20 | 10 |
| Relays | 60 | 20 |
| Executes | 60 | 30 |

## Deploy

`cf` (Cloudflare's CLI) must be logged in. Loading `cloudflare.config.ts` needs Node 22.18+, not Bun.

```bash
cd apps/sponsor
bun run deploy:dry
```

The real deploy uploads `SPONSOR_KEY` as a secret from `.secrets.json`, a gitignored `{"SPONSOR_KEY": "0x…"}`. Delete the file afterwards.

```bash
bun run deploy
```

Check it with the probe, which spends a little Sepolia ETH:

```bash
SPONSOR_URL=https://canon-sponsor.prakashharsh32.workers.dev bun scripts/execute-probe.ts
```

## What it sees

The calldata it submits, which goes on chain anyway, and the IP of whoever calls it unless the call comes through Nox. In Nox mode the extension reaches the https sponsor through a Nox TLS tunnel; when no exit offers one, sponsored actions fail closed ([status.md](status.md)).
