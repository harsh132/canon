// RAILGUN broadcasters: third parties that submit a private transaction from
// their own address and take their fee from the private balance. With one, no
// public address of the user's ever appears on a private send.
//
// Discovery and submission run over Waku, RAILGUN's p2p network, not through
// Nox. Waku peers see this browser's IP; requests to a broadcaster are
// encrypted to its key.
import { WakuBroadcasterClient, BroadcasterTransaction } from '@railgun-community/waku-broadcaster-client-web';
import { BroadcasterConnectionStatus, TXIDVersion, type PreTransactionPOIsPerTxidLeafPerList } from '@railgun-community/shared-models';
import { CHAIN, DEV } from './config';
import { emit, state } from './state';

let starting: Promise<void> | null = null;

const refreshCount = (): void => {
  const all = WakuBroadcasterClient.findAllBroadcastersForChain(CHAIN, false) ?? [];
  state.broadcaster.count = new Set(all.map((b: { railgunAddress: string }) => b.railgunAddress)).size;
};

/** Starts Waku discovery once. Holds no user data; safe before unlock. */
export const startBroadcasters = (): Promise<void> =>
  (starting ??= (async () => {
    state.broadcaster = { status: 'connecting', count: 0 };
    emit();
    try {
      await WakuBroadcasterClient.start(
        CHAIN,
        { trustedFeeSigner: '' },
        (_chain, status) => {
          state.broadcaster.status =
            status === BroadcasterConnectionStatus.Connected
              ? 'connected'
              : status === BroadcasterConnectionStatus.Error
                ? 'error'
                : status === BroadcasterConnectionStatus.AllUnavailable
                  ? 'none'
                  : 'connecting';
          refreshCount();
          emit();
        },
        DEV
          ? { log: (m: string) => console.log('[broadcaster]', m), error: (e: Error) => console.warn('[broadcaster]', e.message) }
          : undefined,
      );
    } catch (e) {
      starting = null;
      state.broadcaster = { status: 'error', count: 0, error: (e as Error).message };
      emit();
    }
  })());

export type Chosen = { railgunAddress: string; feesID: string; feePerUnitGas: bigint };

/** Cheapest reliable broadcaster taking fees in `token`. Relay Adapt is needed to unshield to ETH. */
export const pickBroadcaster = (token: string, useRelayAdapt: boolean): Chosen | null => {
  const best = WakuBroadcasterClient.findBestBroadcaster(CHAIN, token, useRelayAdapt);
  if (!best) return null;
  return { railgunAddress: best.railgunAddress, feesID: best.tokenFee.feesID, feePerUnitGas: BigInt(best.tokenFee.feePerUnitGas) };
};

export const submitViaBroadcaster = async (p: {
  to: string;
  data: string;
  broadcaster: Chosen;
  nullifiers: string[];
  overallBatchMinGasPrice: bigint;
  useRelayAdapt: boolean;
  pois: PreTransactionPOIsPerTxidLeafPerList;
}): Promise<string> => {
  // The broadcaster finds our tx by nullifier; without them the send would hang.
  if (!p.nullifiers.length) throw new Error('Proved transaction carried no nullifiers');
  const tx = await BroadcasterTransaction.create(
    TXIDVersion.V2_PoseidonMerkle,
    p.to,
    p.data,
    p.broadcaster.railgunAddress,
    p.broadcaster.feesID,
    CHAIN,
    p.nullifiers,
    p.overallBatchMinGasPrice,
    p.useRelayAdapt,
    p.pois,
  );
  return tx.send();
};
