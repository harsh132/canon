// The sponsor on Cloudflare Workers (cf deploy). One Durable Object holds the
// queue for the sponsor's single nonce. SPONSOR_KEY is a secret, uploaded at
// deploy time from .env and never stored here.
import { bindings, defineConfig, exports } from 'cf/config';
import * as entrypoint from './src/worker.ts' with { type: 'cf-worker' };

export default defineConfig({
  worker: {
    name: 'canon-sponsor',
    entrypoint,
    compatibilityDate: '2026-11-01',
    compatibilityFlags: ['nodejs_compat'],
    workersDev: true,
    env: {
      SPONSOR: bindings.durableObject({ worker: 'canon-sponsor', exportName: 'Sponsor' }),
      SPONSOR_KEY: bindings.secret(),
      SUBREGISTRY: bindings.text('0x8cA3Dc27639766aeC78e11cb9fB27443148FC639'),
      SEPOLIA_RPC: bindings.text('https://ethereum-sepolia-rpc.publicnode.com'),
      PARENT_LABEL: bindings.text('canon'),
    },
    exports: {
      Sponsor: exports.durableObject({ storage: 'sqlite' }),
    },
  },
});
