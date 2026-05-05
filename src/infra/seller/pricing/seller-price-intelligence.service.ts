/**
 * Seller price intelligence service — smart competitor analysis.
 *
 * Stores competitor price snapshots, detects price floors over rolling
 * windows, applies profit-maximizing positioning logic, and protects
 * against bot wars and wasteful price changes.
 *
 * Ported from supabase/functions/provider-procurement/services/seller-price-intelligence.service.ts
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../../core/ports/database.port.js';
import type { CompetitorPrice } from '../../../core/ports/marketplace-adapter.port.js';
import type { SellerProviderConfig } from '../../../core/use-cases/seller/seller.types.js';
import {
  activeNonOwnSorted,
  computeUndampenedOptimalTarget,
  summarizeLiveCompetition,
} from './seller-pricing-math.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('seller-price-intelligence');

// Re-exports for convenience
export {
  activeNonOwnSorted,
  summarizeLiveCompetition,
  computeUndampenedOptimalTarget,
} from './seller-pricing-math.js';
export type { LiveCompetitionSummary, UndampenedTargetResult } from './seller-pricing-math.js';

// ─── Snapshot Dedup Cache ────────────────────────────────────────────

const SNAPSHOT_MIN_INTERVAL_MS = 10 * 60_000;

interface SnapshotFingerprint {
  lastWriteAt: number;
  lowestPriceCents: number;
  ourPosition: number | null;
  competitorCount: number;
}

const snapshotDedupCache = new Map<string, SnapshotFingerprint>();

function buildFingerprint(competitors: CompetitorPrice[]): Omit<SnapshotFingerprint, 'lastWriteAt'> {
  const active = competitors.filter((c) => c.inStock && c.isOwnOffer !== true);
  const sorted = active.map((c) => c.priceCents).sort((a, b) => a - b);
  const ownIdx = competitors.findIndex((c) => c.isOwnOffer === true);

  let ourPosition: number | null = null;
  if (ownIdx !== -1) {
    const ownPrice = competitors[ownIdx].priceCents;
    ourPosition = sorted.filter((p) => p < ownPrice).length + 1;
  }

  return {
    lowestPriceCents: sorted[0] ?? 0,
    ourPosition,
    competitorCount: active.length,
  };
}

function shouldPersistSnapshot(listingId: string, competitors: CompetitorPrice[]): boolean {
  const now = Date.now();
  const fp = buildFingerprint(competitors);
  const prev = snapshotDedupCache.get(listingId);

  if (!prev) {
    snapshotDedupCache.set(listingId, { ...fp, lastWriteAt: now });
    return true;
  }

  const materialChange =
    fp.lowestPriceCents !== prev.lowestPriceCents ||
    fp.ourPosition !== prev.ourPosition ||
    fp.competitorCount !== prev.competitorCount;

  if (materialChange || now - prev.lastWriteAt >= SNAPSHOT_MIN_INTERVAL_MS) {
    snapshotDedupCache.set(listingId, { ...fp, lastWriteAt: now });
    return true;
  }

  return false;
}

// ─── Shared Helpers ──────────────────────────────────────────────────

/**
 * When we know our marketplace offer id, force explicit isOwnOffer flags.
 */
export function stampCompetitorOwnership(
  competitors: CompetitorPrice[],
  ourExternalListingId: string | null | undefined,
): CompetitorPrice[] {
  const ours = ourExternalListingId?.trim();
  if (!ours) return competitors;
  return competitors.map((row) => {
    const id = row.externalListingId?.trim();
    if (id && id === ours) {
      return { ...row, isOwnOffer: true };
    }
    if (row.isOwnOffer === true) {
      return row;
    }
    return { ...row, isOwnOffer: false as const };
  });
}

// ─── Types ───────────────────────────────────────────────────────────

export interface CompetitorFloorData {
  lowest_competitor_cents: number | null;
  second_lowest_cents: number | null;
  floor_price_cents: number | null;
  competitor_count: number;
  price_stable_since: string | null;
  our_current_position: number | null;
}

export interface PositionAnalysis {
  suggestedPriceCents: number;
  reasonCode: string;
  reason: string;
  shouldChange: boolean;
  skipReason?: string;
  proposedPriceCents: number | null;
  dampeningProgress?: { confirmed: number; required: number };
}

export interface CompetitorSnapshotRow {
  seller_listing_id: string;
  provider_code: string;
  external_product_id: string;
  merchant_name: string | null;
  price_cents: number;
  currency: string | null;
  in_stock: boolean;
  is_own_offer: boolean;
}

export interface OscillationResult {
  isOscillating: boolean;
  changeCount: number;
  reason?: string;
}

// ─── Service ─────────────────────────────────────────────────────────

@injectable()
export class SellerPriceIntelligenceService {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  // ─── 1. Competitor Snapshot Persistence ────────────────────────────

  async prepareCompetitorSnapshot(
    listingId: string,
    providerCode: string,
    externalProductId: string,
    competitors: CompetitorPrice[],
    variantId?: string | null,
  ): Promise<CompetitorSnapshotRow[]> {
    if (competitors.length === 0) return [];

    if (variantId) {
      await this.recordTimelineFromCompetitors(variantId, providerCode, competitors);
    }

    if (!shouldPersistSnapshot(listingId, competitors)) {
      return [];
    }

    return competitors.map((c) => ({
      seller_listing_id: listingId,
      provider_code: providerCode,
      external_product_id: externalProductId,
      merchant_name: c.merchantName,
      price_cents: c.priceCents,
      currency: c.currency,
      in_stock: c.inStock,
      is_own_offer: c.isOwnOffer ?? false,
    }));
  }

  async flushCompetitorSnapshots(rows: CompetitorSnapshotRow[]): Promise<{ inserted: number; failed: boolean }> {
    if (rows.length === 0) return { inserted: 0, failed: false };

    try {
      await this.db.insertMany('seller_competitor_snapshots', rows as unknown as Record<string, unknown>[]);
      return { inserted: rows.length, failed: false };
    } catch (err) {
      logger.error('Failed to batch-insert competitor snapshots', {
        rowCount: rows.length,
        error: err instanceof Error ? err.message : String(err),
      });
      return { inserted: 0, failed: true };
    }
  }

  async storeCompetitorSnapshot(
    listingId: string,
    providerCode: string,
    externalProductId: string,
    competitors: CompetitorPrice[],
    variantId?: string | null,
  ): Promise<void> {
    const rows = await this.prepareCompetitorSnapshot(
      listingId, providerCode, externalProductId, competitors, variantId,
    );
    await this.flushCompetitorSnapshots(rows);
  }

  private async recordTimelineFromCompetitors(
    variantId: string,
    providerCode: string,
    competitors: CompetitorPrice[],
  ): Promise<void> {
    if (competitors.length === 0) return;

    const inStock = competitors.filter((c) => c.inStock);
    const pool = inStock.length > 0 ? inStock : competitors;

    let cheapest = pool[0];
    for (const c of pool) {
      if (c.priceCents < cheapest.priceCents) cheapest = c;
    }
    if (!cheapest || cheapest.priceCents <= 0) return;

    const competitorCount = competitors.filter((c) => c.isOwnOffer !== true).length;
    const currency = competitors.find((c) => c.currency)?.currency ?? null;

    try {
      await this.db.rpc('record_variant_price_timeline', {
        p_variant_id: variantId,
        p_provider_code: providerCode,
        p_currency: currency,
        p_cheapest_cents: cheapest.priceCents,
        p_cheapest_merchant: cheapest.merchantName ?? null,
        p_cheapest_was_ours: cheapest.isOwnOffer === true,
        p_cheapest_in_stock: cheapest.inStock,
        p_competitor_count: competitorCount,
      });
    } catch (err) {
      logger.warn('Failed to record variant_price_timeline', {
        variantId,
        providerCode,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ─── 2. Compute / Update Competitor Floors ────────────────────────

  async computeCompetitorFloors(
    listingId: string,
    competitors: CompetitorPrice[],
  ): Promise<CompetitorFloorData> {
    const live = summarizeLiveCompetition(competitors);
    const lowest = live.lowestNonOwnCents;
    const secondLowest = live.secondLowestNonOwnCents;
    const ourPosition = live.ourPositionBefore;
    const nonOwn = activeNonOwnSorted(competitors);

    const existing = await this.db.queryOne<{
      lowest_competitor_cents: number | null;
      price_stable_since: string | null;
      floor_price_cents: number | null;
    }>('seller_competitor_floors', {
      eq: [['seller_listing_id', listingId]],
    });

    let stableSince: string | null = null;
    let cachedFloorCents: number | null = null;

    if (existing) {
      cachedFloorCents = existing.floor_price_cents;
      stableSince = existing.lowest_competitor_cents === lowest
        ? (existing.price_stable_since ?? new Date().toISOString())
        : new Date().toISOString();
    } else {
      stableSince = new Date().toISOString();
    }

    const floorCents = cachedFloorCents ?? lowest;

    const floorRow = {
      seller_listing_id: listingId,
      lowest_competitor_cents: lowest,
      second_lowest_cents: secondLowest,
      floor_price_cents: floorCents,
      competitor_count: nonOwn.length,
      price_stable_since: stableSince,
      our_current_position: ourPosition,
      updated_at: new Date().toISOString(),
    };

    try {
      await this.db.upsert('seller_competitor_floors', floorRow, 'seller_listing_id');
    } catch (err) {
      logger.error('Failed to upsert competitor floor', {
        listingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      lowest_competitor_cents: lowest,
      second_lowest_cents: secondLowest,
      floor_price_cents: floorCents,
      competitor_count: nonOwn.length,
      price_stable_since: stableSince,
      our_current_position: ourPosition,
    };
  }

  // ─── 3. Analyze Optimal Position ──────────────────────────────────

  async analyzeOptimalPosition(
    listing: { id: string; price_cents: number },
    competitors: CompetitorPrice[],
    floorData: CompetitorFloorData,
    effectiveMinPrice: number,
    config: SellerProviderConfig,
    listingCompareGrossCents?: number,
  ): Promise<PositionAnalysis> {
    const compareGross = listingCompareGrossCents ?? listing.price_cents;

    const und = computeUndampenedOptimalTarget(
      competitors,
      { floor_price_cents: floorData.floor_price_cents },
      effectiveMinPrice,
      config,
    );

    if (und === null) {
      return {
        suggestedPriceCents: compareGross,
        reasonCode: 'no_competitors',
        reason: 'no_competitors',
        shouldChange: false,
        skipReason: 'No in-stock competitors found',
        proposedPriceCents: null,
      };
    }

    const { targetPrice, reasonCode, reason } = und;
    const p1 = und.p1;

    if (config.dampening_snapshots > 1) {
      const dampenResult = await this.checkDampening(
        listing.id, p1, config.dampening_snapshots,
      );
      if (!dampenResult.confirmed) {
        return {
          suggestedPriceCents: compareGross,
          reasonCode: 'dampening',
          reason: 'dampening',
          shouldChange: false,
          skipReason: dampenResult.count === 0
            ? `No competitor snapshots yet — enable auto-sync to start collecting data (0/${config.dampening_snapshots})`
            : `Price drop not confirmed for ${config.dampening_snapshots} snapshots (${dampenResult.count}/${config.dampening_snapshots})`,
          proposedPriceCents: targetPrice,
          dampeningProgress: {
            confirmed: dampenResult.count,
            required: config.dampening_snapshots,
          },
        };
      }
    }

    if (targetPrice === compareGross) {
      return {
        suggestedPriceCents: targetPrice,
        reasonCode,
        reason,
        shouldChange: false,
        skipReason: 'Target price equals current price',
        proposedPriceCents: targetPrice,
      };
    }

    return {
      suggestedPriceCents: targetPrice,
      reasonCode,
      reason,
      shouldChange: true,
      proposedPriceCents: targetPrice,
    };
  }

  // ─── 4. Is Price Change Worth It? ─────────────────────────────────

  isPriceChangeWorthIt(
    currentPriceCents: number,
    newPriceCents: number,
    feeCents: number,
    minDeltaCents: number,
  ): { worthIt: boolean; reason?: string } {
    const delta = Math.abs(newPriceCents - currentPriceCents);

    if (delta < minDeltaCents) {
      return { worthIt: false, reason: `Delta ${delta}c < min ${minDeltaCents}c threshold` };
    }
    if (feeCents > 0 && delta <= feeCents) {
      return { worthIt: false, reason: `Delta ${delta}c <= fee ${feeCents}c — not profitable` };
    }
    return { worthIt: true };
  }

  // ─── 5. Detect Oscillation (Bot War Protection) ───────────────────

  async detectOscillation(
    listingId: string,
    windowHours: number,
    threshold = 4,
  ): Promise<OscillationResult> {
    const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

    try {
      const rows = await this.db.query<{ price_cents: number; recorded_at: string }>(
        'seller_competitor_snapshots',
        {
          eq: [
            ['seller_listing_id', listingId],
            ['is_own_offer', true],
          ],
          gte: [['recorded_at', cutoff]],
          order: { column: 'recorded_at', ascending: true },
        },
      );

      if (!rows || rows.length < 2) {
        return { isOscillating: false, changeCount: 0 };
      }

      let changeCount = 0;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].price_cents !== rows[i - 1].price_cents) changeCount++;
      }

      if (changeCount >= threshold) {
        return {
          isOscillating: true,
          changeCount,
          reason: `${changeCount} price oscillations in ${windowHours}h window (threshold: ${threshold})`,
        };
      }

      return { isOscillating: false, changeCount };
    } catch {
      return { isOscillating: false, changeCount: 0 };
    }
  }

  // ─── Internal Helpers ─────────────────────────────────────────────

  private async checkDampening(
    listingId: string,
    currentLowestCents: number,
    requiredSnapshots: number,
  ): Promise<{ confirmed: boolean; count: number }> {
    try {
      const rows = await this.db.query<{ price_cents: number; recorded_at: string }>(
        'seller_competitor_snapshots',
        {
          eq: [
            ['seller_listing_id', listingId],
            ['is_own_offer', false],
            ['in_stock', true],
          ],
          order: { column: 'recorded_at', ascending: false },
          limit: requiredSnapshots * 10,
        },
      );

      if (!rows || rows.length === 0) {
        return { confirmed: false, count: 0 };
      }

      const cycleMap = new Map<string, number>();
      for (const row of rows) {
        const existing = cycleMap.get(row.recorded_at);
        if (existing === undefined || row.price_cents < existing) {
          cycleMap.set(row.recorded_at, row.price_cents);
        }
      }

      const cycleMinimums = [...cycleMap.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([, min]) => min);

      let confirmedCount = 0;
      for (const cycleMin of cycleMinimums) {
        if (cycleMin <= currentLowestCents) {
          confirmedCount++;
        } else {
          break;
        }
        if (confirmedCount >= requiredSnapshots) break;
      }

      return {
        confirmed: confirmedCount >= requiredSnapshots,
        count: confirmedCount,
      };
    } catch {
      return { confirmed: false, count: 0 };
    }
  }
}
