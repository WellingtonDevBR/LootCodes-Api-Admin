/**
 * IBuyerWalletSnapshotter — one-shot probe of every buyer-capable provider's
 * wallet balances at the start of a reconcile run.
 *
 * Designed for fan-out efficiency: instead of N listings × N providers calling
 * `walletPreflight` live, the credit-aware reconcile snapshots all wallets
 * once and consults the in-memory map per listing.
 *
 * Tolerant of partial failure — if one provider's wallet API throws, that
 * provider's currency map is empty (= "no credit anywhere") and the
 * snapshotter keeps going for the others. The reconcile then treats that
 * provider as uncreditable for the cycle and tries the next-cheapest
 * candidate that does have credit.
 */

/**
 * `currency (ISO 4217 uppercase) -> spendable cents` for one provider account.
 * Empty map means "no credit in any currency".
 */
export type ProviderWalletMap = ReadonlyMap<string, number>;

/**
 * `provider_accounts.id -> ProviderWalletMap`. Keyed by account id (not by
 * `provider_code`) so the same provider integration with multiple accounts
 * each gets its own row — different wallets, different credit pools.
 */
export type WalletSnapshot = ReadonlyMap<string, ProviderWalletMap>;

export interface IBuyerWalletSnapshotter {
  /**
   * Probe every enabled buyer-capable provider account's wallet API and
   * return a snapshot of spendable cents per (account, currency).
   *
   * MUST never throw. Per-provider failures yield an empty `ProviderWalletMap`
   * for that account.
   */
  snapshot(): Promise<WalletSnapshot>;
}

/**
 * Look up spendable cents for an offer in a given currency on a given
 * provider account. Returns `0` when the snapshot has no row for that
 * account or no entry for that currency — both mean "no credit, skip".
 */
export function getSpendableCentsFromSnapshot(
  snapshot: WalletSnapshot,
  providerAccountId: string,
  currencyIso: string,
): number {
  const wallets = snapshot.get(providerAccountId);
  if (!wallets) return 0;
  const code = currencyIso.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return 0;
  return wallets.get(code) ?? 0;
}
