// When pending private funds become spendable. Plain data and no dependencies,
// so the core computes it, the popup prints it and scripts/check-eta.ts runs it.

/** Shield hold per network (chain id). RAILGUN's config has no such field: this is measured.
 *  Sepolia: spendable about 12 min after Make private (2026-11-06). No entry, no estimate. */
export const SHIELD_HOLD_MS: Record<number, number> = { 11155111: 12 * 60_000 };

/** readyAt: ms epoch when the hold ends. 0 when no hold applies, so only proof of innocence is left. */
export type PendingEta = { readyAt: number } | null;

/** at: the note's block time in seconds, 0 when unknown. */
export type PendingNote = { shield: boolean; at: number };

/** When the last pending note with data could clear. Null when no note has the data for it.
 *  The latest, not the soonest: a note already waiting only on proof of innocence (one from a
 *  private send, or one stuck there) must not hide a new shield's hold. */
export const pendingEta = (notes: PendingNote[], holdMs: number | undefined): PendingEta => {
  let readyAt: number | null = null;
  for (const n of notes) {
    // Only a shield waits out the hold; a note from a private send waits on proof of innocence alone.
    const t = !n.shield ? 0 : holdMs != null && n.at > 0 ? n.at * 1000 + holdMs : null;
    if (t != null && (readyAt == null || t > readyAt)) readyAt = t;
  }
  return readyAt == null ? null : { readyAt };
};

/** Null when there is nothing to say. Whole minutes, rounded up, never below 1. */
export const etaText = (eta: PendingEta | undefined, now: number): string | null => {
  if (!eta) return null;
  if (eta.readyAt <= now) return 'Clearing proof of innocence';
  return `Spendable in about ${Math.ceil((eta.readyAt - now) / 60_000)} min`;
};
