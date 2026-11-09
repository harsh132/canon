// Dev helper: create a sponsor key (if none) and fund it from the extension's
// Sepolia test wallet Main: ETH for gas, and all its USDC for the parent fee.
//   bun scripts/fund-from-test-wallet.ts [ethAmount]
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Contract, HDNodeWallet, JsonRpcProvider, Wallet, formatUnits, parseEther } from 'ethers';
import { A } from '../src/ens';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
let env = existsSync(envFile) ? readFileSync(envFile, 'utf8') : readFileSync(fileURLToPath(new URL('../.env.example', import.meta.url)), 'utf8');
if (!/^SPONSOR_KEY=0x[0-9a-f]{64}$/m.test(env)) {
  env = env.replace(/^SPONSOR_KEY=.*$/m, `SPONSOR_KEY=${Wallet.createRandom().privateKey}`);
  writeFileSync(envFile, env);
}
const sponsorKey = env.match(/^SPONSOR_KEY=(0x[0-9a-f]{64})$/m)![1];
const provider = new JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com', 11155111, { staticNetwork: true });
const sponsor = new Wallet(sponsorKey).address;

const walletFile = fileURLToPath(new URL('../../extension/.cache/sepolia/wallet.json', import.meta.url));
const { phrase } = JSON.parse(readFileSync(walletFile, 'utf8'));
const main = HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/60'/0'/0/0").connect(provider);
const usdc = new Contract(A.USDC, ['function transfer(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'], main);

console.log('from Main', main.address, '-> sponsor', sponsor);
const eth = parseEther(process.argv[2] ?? '0.015');
await (await main.sendTransaction({ to: sponsor, value: eth })).wait();
const bal = (await usdc.balanceOf(main.address)) as bigint;
if (bal > 0n) await (await usdc.transfer(sponsor, bal)).wait();
console.log('sponsor now has', formatUnits(await provider.getBalance(sponsor)), 'ETH,', formatUnits(await usdc.balanceOf(sponsor), 6), 'USDC');
