// Ops: rebroadcast a stuck sponsor transaction at a higher gas price, same nonce.
//   bun scripts/replace-stuck.ts <txHash>
import { connect } from '../src/ens';
import { priceFor } from '../src/relay';
const { sponsor, provider } = connect();
const hash = process.argv[2];
const old = await provider.getTransaction(hash);
if (!old) throw new Error('not found');
const gasPrice = await priceFor(provider, old.gasPrice! * 2n);
const tx = await sponsor.sendTransaction({ to: old.to!, data: old.data, nonce: old.nonce, gasLimit: old.gasLimit, gasPrice, type: 0 });
console.log('replacement', tx.hash, 'gasPrice', gasPrice.toString());
const r = await tx.wait();
console.log('status', r?.status, 'block', r?.blockNumber, 'from', r?.from);
