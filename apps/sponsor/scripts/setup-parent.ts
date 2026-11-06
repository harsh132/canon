// One-time: register <PARENT_LABEL>.eth on Sepolia with a UserRegistry the
// sponsor controls only as REGISTRAR + RENEW, then renounce the power to swap
// that registry out. Resumable; state in .data/parent.json.
//   bun scripts/setup-parent.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { formatUnits, hexlify, id, randomBytes } from 'ethers';
import { A, R, ZERO, adm, connect, labelId, registryIface } from '../src/ens';

const LABEL = process.env.PARENT_LABEL ?? 'pangolin';
const YEARS = BigInt(process.env.YEARS ?? 1);
const DURATION = YEARS * 365n * 24n * 3600n;
const stateFile = new URL('../.data/parent.json', import.meta.url).pathname;
mkdirSync(new URL('../.data/', import.meta.url).pathname, { recursive: true });
const state: Record<string, string> = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));

const { provider, sponsor, registrar, ethRegistry, factory, usdc } = connect();
const log = (...a: unknown[]) => console.log('[parent]', ...a);
const wait = async (label: string, tx: Promise<{ wait: () => Promise<{ status: number; gasUsed: bigint; hash: string } | null> }>) => {
  const r = await (await tx).wait();
  log(`${label}: status ${r?.status} gas ${r?.gasUsed} ${r?.hash}`);
  if (r?.status !== 1) throw new Error(`${label} failed`);
};

log('sponsor', sponsor.address, 'ETH', formatUnits(await provider.getBalance(sponsor.address)), 'USDC', formatUnits(await usdc.balanceOf(sponsor.address), 6));

// 1. Subregistry proxy.
const salt = BigInt(id(`subregistry:${LABEL}`));
const sub = (await factory.predictProxyAddress(sponsor.address, salt)) as string;
if ((await provider.getCode(sub)) === '0x') {
  await wait(
    'deploy UserRegistry (sponsor: REGISTRAR + RENEW)',
    factory.deployProxy(A.USER_REGISTRY_IMPL, salt, registryIface.encodeFunctionData('initialize', [[[sponsor.address, R.REGISTRAR | R.RENEW]]])),
  );
}
state.subregistry = sub;
save();
log('subregistry', sub);

// 2. Register the parent.
if (await registrar.isAvailable(LABEL)) {
  const [base, premium] = (await registrar.getRegisterPrice(LABEL, DURATION, A.USDC)) as [bigint, bigint];
  log(`price ${LABEL}.eth, ${YEARS}y: ${formatUnits(base + premium, 6)} USDC`);
  await wait('USDC.approve(registrar)', usdc.approve(A.ETH_REGISTRAR, base + premium));
  const secret = state.secret ?? hexlify(randomBytes(32));
  state.secret = secret;
  save();
  const commitment = await registrar.makeCommitment(LABEL, sponsor.address, secret, sub, ZERO, DURATION, '0x' + '00'.repeat(32));
  await wait('commit', registrar.commit(commitment));
  const age = Number(await registrar.MIN_COMMITMENT_AGE());
  log(`waiting ${age + 15}s for the commitment to mature`);
  await new Promise((r) => setTimeout(r, (age + 15) * 1000));
  await wait(`register ${LABEL}.eth`, registrar.register(LABEL, sponsor.address, secret, sub, ZERO, DURATION, A.USDC, '0x' + '00'.repeat(32)));
} else {
  log(`${LABEL}.eth already registered`);
}
const current = ((await ethRegistry.getSubregistry(LABEL)) as string).toLowerCase();
if (current !== sub.toLowerCase()) throw new Error(`${LABEL}.eth points at subregistry ${current}, not ours`);
log(`${LABEL}.eth -> subregistry ✓`);

// 3. Renounce the power to swap the subregistry (it would hijack every subname).
const parentId = labelId(LABEL);
try {
  await ethRegistry.revokeRoles.staticCall(parentId, R.SET_SUBREGISTRY | adm(R.SET_SUBREGISTRY), sponsor.address);
  await wait('revoke SET_SUBREGISTRY (+admin) from sponsor', ethRegistry.revokeRoles(parentId, R.SET_SUBREGISTRY | adm(R.SET_SUBREGISTRY), sponsor.address));
} catch (e) {
  log('revoke skipped:', (e as Error).message.slice(0, 120));
}
const canSwap = await ethRegistry.setSubregistry.staticCall(parentId, sponsor.address).then(
  () => true,
  () => false,
);
log('sponsor can still swap the subregistry:', canSwap ? 'YES ✗' : 'no ✓');
state.parent = `${LABEL}.eth`;
state.renounced = String(!canSwap);
save();
