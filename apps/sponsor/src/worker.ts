// The sponsor on Cloudflare: every request goes to one Durable Object, which
// runs the shared app (app.ts). One instance means one transaction queue for the
// sponsor's single nonce, and one set of hourly caps.
import { DurableObject } from 'cloudflare:workers';
import { makeApp } from './app';

type Env = {
  SPONSOR: DurableObjectNamespace;
  SPONSOR_KEY: string;
  SUBREGISTRY: string;
  SEPOLIA_RPC?: string;
  PARENT_LABEL?: string;
};

export class Sponsor extends DurableObject<Env> {
  #app: ReturnType<typeof makeApp> | null = null;

  async fetch(req: Request): Promise<Response> {
    this.#app ??= makeApp({
      key: this.env.SPONSOR_KEY,
      rpc: this.env.SEPOLIA_RPC,
      parent: this.env.PARENT_LABEL,
      subregistry: this.env.SUBREGISTRY,
      // Public deployment: tighter than local.
      caps: { claim: 10, relay: 20, execute: 30 },
    });
    return this.#app.fetch(req);
  }
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return env.SPONSOR.get(env.SPONSOR.idFromName('sponsor')).fetch(req);
  },
};
