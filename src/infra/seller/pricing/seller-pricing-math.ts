/**
 * Pure seller pricing math (no I/O). Shared by intelligence service + auto-pricing.
 *
 * Ported from supabase/functions/provider-procurement/services/seller-pricing-math.ts
 */
import type { CompetitorPrice } from '../../../core/ports/marketplace-adapter.port.js';

export interface LiveCompetitionSummary {
  lowestNonOwnCents: number | null;
  secondLowestNonOwnCents: number | null;
  ourPositionBefore: number | null;
  nonOwnCount: number;
}

export interface UndampenedFloorInput {
  floor_price_cents: number | null;
}

export interface UndampenedConfigInput {
  max_position_target: number;
  position_gap_threshold_pct: number;
}

export interface UndampenedTargetResult {
  targetPrice: number;
  reasonCode: string;
  reason: string;
  p1: number;
  p2: number | null;
  gapPct: number | null;
}

/**
 * In-stock competitors we are sure are not our listing.
 * `isOwnOffer: null` means unknown — must NOT be treated as non-own.
 */
export function activeNonOwnSorted(competitors: CompetitorPrice[]): CompetitorPrice[] {
  return competitors
    .filter((c) => c.isOwnOffer === false && c.inStock)
    .sort((a, b) => a.priceCents - b.priceCents);
}

/**
 * Live API snapshot: P1/P2 among competitors, our buy-box rank among in-stock offers.
 */
export function summarizeLiveCompetition(competitors: CompetitorPrice[]): LiveCompetitionSummary {
  const nonOwn = activeNonOwnSorted(competitors);
  const lowestNonOwnCents = nonOwn[0]?.priceCents ?? null;
  const secondLowestNonOwnCents = nonOwn.length > 1 ? nonOwn[1].priceCents : null;

  const ownOffer = competitors.find((c) => c.isOwnOffer === true && c.inStock);
  let ourPositionBefore: number | null = null;
  if (ownOffer) {
    const allInStock = competitors.filter((c) => c.inStock).sort((a, b) => a.priceCents - b.priceCents);
    const idx = allInStock.findIndex((c) => c.isOwnOffer === true);
    ourPositionBefore = idx >= 0 ? idx + 1 : null;
  }

  return {
    lowestNonOwnCents,
    secondLowestNonOwnCents,
    ourPositionBefore,
    nonOwnCount: nonOwn.length,
  };
}

/**
 * Optimal gross target before dampening / worth-it check.
 */
export function computeUndampenedOptimalTarget(
  competitors: CompetitorPrice[],
  floorData: UndampenedFloorInput,
  effectiveMinPrice: number,
  config: UndampenedConfigInput,
): UndampenedTargetResult | null {
  const nonOwn = activeNonOwnSorted(competitors);
  if (nonOwn.length === 0) return null;

  const p1 = nonOwn[0].priceCents;
  const p2 = nonOwn.length > 1 ? nonOwn[1].priceCents : null;
  const observedFloor = floorData.floor_price_cents;

  let targetPrice: number;
  let reasonCode: string;
  let reason: string;
  let gapPct: number | null = null;

  if (p2 !== null && config.max_position_target >= 2) {
    gapPct = ((p2 - p1) / p1) * 100;

    if (gapPct > config.position_gap_threshold_pct) {
      targetPrice = p2 - 1;
      reasonCode = 'gap_exploit';
      reason = `P1=${p1} P2=${p2} gap=${gapPct.toFixed(1)}% — targeting just below P2`;
    } else if (observedFloor !== null && p1 <= observedFloor) {
      targetPrice = p1 - 1;
      reasonCode = 'floor_match';
      reason = `P1=${p1} at floor=${observedFloor} — minimal undercut`;
    } else {
      targetPrice = p1 - 1;
      reasonCode = 'standard_undercut';
      reason = `P1=${p1} P2=${p2} gap=${gapPct.toFixed(1)}%`;
    }
  } else if (observedFloor !== null && p1 <= observedFloor) {
    targetPrice = p1 - 1;
    reasonCode = 'floor_match';
    reason = `P1=${p1} at floor=${observedFloor}`;
  } else {
    targetPrice = p1 - 1;
    reasonCode = 'undercut_leader';
    reason = `P1=${p1}`;
  }

  targetPrice = Math.max(targetPrice, effectiveMinPrice);

  // When P1 is below the profitability floor we cannot match the cheapest
  // sellers. Instead of sitting at the bare floor, scan upward for the first
  // competitor priced ABOVE the floor and position 1 cent below them — this
  // captures the revenue gap between our floor and the next profitable slot.
  //
  // Example: floor=€15.30, competitors=[€15.09, €15.12, €15.20, €15.45, €15.57]
  //   P1=€15.09 < floor → firstAboveFloor=€15.45 → target=€15.44 (not €15.30)
  if (p1 < effectiveMinPrice) {
    const firstAboveFloor = nonOwn.find((c) => c.priceCents > effectiveMinPrice);
    if (firstAboveFloor) {
      const gapTarget = firstAboveFloor.priceCents - 1;
      if (gapTarget > effectiveMinPrice) {
        targetPrice = gapTarget;
        reasonCode = 'gap_above_floor';
        reason = `P1=${p1} below floor=${effectiveMinPrice}; first above=${firstAboveFloor.priceCents} — targeting ${gapTarget}`;
      }
    }
  }

  return { targetPrice, reasonCode, reason, p1, p2, gapPct };
}

/**
 * Minimum gross price (cents) such that profit-on-cost meets the target.
 *
 * Returns null when inputs are invalid (commission >= 100% is impossible).
 */
export function computeProfitabilityFloorCents(
  costCents: number,
  commissionRatePercent: number,
  pct: number,
  fixedFeeCents = 0,
): number | null {
  if (!Number.isFinite(costCents) || costCents <= 0) return null;
  if (!Number.isFinite(pct) || pct <= 0) return null;
  const c = Math.max(0, commissionRatePercent ?? 0) / 100;
  if (1 - c <= 0) return null;
  const p = pct / 100;
  const fee = Math.max(0, fixedFeeCents ?? 0);
  return Math.ceil((costCents * (1 + p) + fee) / (1 - c));
}
