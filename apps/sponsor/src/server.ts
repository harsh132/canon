// Local sponsor: the shared app (app.ts) on Bun.
//   bun src/server.ts
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { makeApp } from './app';

const PORT = Number(process.env.PORT ?? 8792);
const { subregistry } = JSON.parse(readFileSync(fileURLToPath(new URL('../.data/parent.json', import.meta.url)), 'utf8')) as { subregistry: string };
const key = process.env.SPONSOR_KEY;
if (!key) throw new Error('SPONSOR_KEY is not set (apps/sponsor/.env)');
const app = makeApp({ key, rpc: process.env.SEPOLIA_RPC, parent: process.env.PARENT_LABEL, subregistry });

Bun.serve({ port: PORT, hostname: '127.0.0.1', fetch: app.fetch });
console.log(`[sponsor] ${app.parent}.eth subregistry ${app.subregistry}; sponsor ${app.sponsor.address}; http://127.0.0.1:${PORT}`);
