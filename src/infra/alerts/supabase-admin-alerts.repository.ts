import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminAlertsRepository } from '../../core/ports/admin-alerts-repository.port.js';
import type {
  AdminAlertRow,
  ListAlertsDto,
  ListAlertsResult,
  DismissAlertDto,
  DismissAllAlertsDto,
  DismissAllByFilterDto,
  SyncSellerListingPausedAlertsResult,
  SyncSellerListingPricingFrozenAlertsResult,
} from '../../core/use-cases/alerts/alerts.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('supabase-admin-alerts-repository');

const DEFAULT_LIMIT = 200;

const ALERTS_SELECT = [
  'id',
  'alert_type',
  'severity',
  'title',
  'message',
  'related_order_id',
  'related_user_id',
  'metadata',
  'is_read',
  'is_resolved',
  'requires_action',
  'priority',
  'created_at',
  'resolved_at',
  'resolved_by',
].join(', ');

@injectable()
export class SupabaseAdminAlertsRepository implements IAdminAlertsRepository {
  constructor(@inject(TOKENS.Database) private readonly db: IDatabase) {}

  async listAlerts(dto: ListAlertsDto): Promise<ListAlertsResult> {
    logger.debug('listAlerts', { dto });

    const limit = dto.limit ?? DEFAULT_LIMIT;
    const offset = dto.offset ?? 0;

    const eq: Array<[string, unknown]> = [];

    if (dto.is_read !== undefined) eq.push(['is_read', dto.is_read]);
    if (dto.is_resolved !== undefined) eq.push(['is_resolved', dto.is_resolved]);
    if (dto.severity) eq.push(['severity', dto.severity]);
    if (dto.alert_type) eq.push(['alert_type', dto.alert_type]);

    const { data: rows, total } = await this.db.queryPaginated<AdminAlertRow>(
      'admin_alerts',
      {
        select: ALERTS_SELECT,
        eq,
        order: { column: 'created_at', ascending: false },
        range: [offset, offset + limit - 1],
      },
    );

    return { alerts: rows, total_count: total };
  }

  async dismissAlert(dto: DismissAlertDto): Promise<void> {
    logger.debug('dismissAlert', { id: dto.id });

    await this.db.update(
      'admin_alerts',
      { id: dto.id },
      { is_read: true, is_resolved: true, resolved_at: new Date().toISOString() },
    );
  }

  async dismissAllAlerts(dto: DismissAllAlertsDto): Promise<void> {
    logger.debug('dismissAllAlerts', { count: dto.ids.length });

    const now = new Date().toISOString();
    for (const id of dto.ids) {
      await this.db.update(
        'admin_alerts',
        { id },
        { is_read: true, is_resolved: true, resolved_at: now },
      );
    }
  }

  async dismissAllByFilter(dto: DismissAllByFilterDto): Promise<number> {
    logger.debug('dismissAllByFilter', { dto });

    const filter: Record<string, unknown> = { is_resolved: false };
    if (dto.severity) filter.severity = dto.severity;
    if (dto.alert_type) filter.alert_type = dto.alert_type;

    const now = new Date().toISOString();
    const rows = await this.db.update(
      'admin_alerts',
      filter,
      { is_read: true, is_resolved: true, resolved_at: now },
    );
    return rows.length;
  }

  async syncSellerListingPausedAlerts(): Promise<SyncSellerListingPausedAlertsResult> {
    const rawListings = await this.db.queryAll<RawPausedListingRow>('seller_listings', {
      select: 'id, external_listing_id, status, error_message, reservation_consecutive_failures, provider_account_id, variant_id',
      in: [['status', PAUSED_STATES]],
    });

    // Resolve provider_code via provider_accounts (seller_listings has no provider_code column)
    const accountIds = [...new Set(rawListings.map((r) => r.provider_account_id).filter(Boolean))];
    const providerAccounts = accountIds.length
      ? await this.db.queryAll<{ id: string; provider_code: string }>('provider_accounts', {
          select: 'id, provider_code',
          in: [['id', accountIds]],
        })
      : [];
    const providerCodeById = new Map(providerAccounts.map((a) => [a.id, a.provider_code]));

    const pausedListings: PausedListingRow[] = rawListings.map((r) => ({
      ...r,
      provider_code: providerCodeById.get(r.provider_account_id) ?? null,
    }));

    const openAlerts = await this.db.queryAll<OpenSellerPausedAlertRow>('admin_alerts', {
      select: 'id, metadata',
      eq: [
        ['alert_type', SELLER_LISTING_PAUSED_ALERT_TYPE],
        ['is_resolved', false],
      ],
    });

    const pausedById = new Map<string, PausedListingRow>();
    for (const row of pausedListings) pausedById.set(row.id, row);

    const openAlertsByListingId = new Map<string, OpenSellerPausedAlertRow>();
    for (const alert of openAlerts) {
      const listingId = (alert.metadata?.listingId as string | undefined) ?? null;
      if (listingId) openAlertsByListingId.set(listingId, alert);
    }

    let alertsCreated = 0;
    for (const listing of pausedListings) {
      if (openAlertsByListingId.has(listing.id)) continue;
      await this.db.insert('admin_alerts', buildSellerListingPausedAlert(listing));
      alertsCreated += 1;
    }

    let alertsResolved = 0;
    const resolvedAt = new Date().toISOString();
    for (const [listingId, alert] of openAlertsByListingId) {
      if (pausedById.has(listingId)) continue;
      await this.db.update(
        'admin_alerts',
        { id: alert.id },
        { is_read: true, is_resolved: true, resolved_at: resolvedAt },
      );
      alertsResolved += 1;
    }

    logger.info('Synced seller_listing_paused alerts', {
      pausedListingCount: pausedListings.length,
      alertsCreated,
      alertsResolved,
    });

    return {
      alertsCreated,
      alertsResolved,
      pausedListingCount: pausedListings.length,
    };
  }

  async syncSellerListingPricingFrozenAlerts(): Promise<SyncSellerListingPricingFrozenAlertsResult> {
    const frozenCutoffBudget = new Date(Date.now() - FROZEN_BUDGET_HOURS * 60 * 60 * 1000).toISOString();
    const frozenCutoffBelowCost = new Date(Date.now() - FROZEN_BELOW_COST_HOURS * 60 * 60 * 1000).toISOString();

    // 1. Listings with auto_sync_price=true that have been priced below cost basis for >1h.
    const belowCost = await this.db.queryAll<RawFrozenListingRow>('seller_listings', {
      select: 'id, external_listing_id, price_cents, cost_basis_cents, currency, provider_account_id, variant_id, updated_at',
      eq: [
        ['status', 'active'],
        ['auto_sync_price', true],
      ],
      lt: [['updated_at', frozenCutoffBelowCost]],
    });
    const belowCostFiltered = belowCost.filter(
      (r) => r.price_cents > 0 && r.cost_basis_cents > 0 && r.price_cents < r.cost_basis_cents,
    );

    // 2. Listings whose CURRENT (latest) pricing decision is budget_exhausted, and
    //    that decision is older than the 6 h cutoff. We must look at the latest
    //    decision per listing — not just any budget_exhausted decision — otherwise
    //    a listing that subsequently pushed successfully would still get flagged.
    //
    //    Scoping the scan to the past 48 h keeps the result set bounded while
    //    covering every listing that has had any pricing activity recently. A
    //    listing with no decisions in 48 h is by definition not actively churning
    //    on budget_exhausted and is therefore not flagged here.
    const decisionScanCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const recentDecisions = await this.db.queryAll<{
      readonly seller_listing_id: string;
      readonly action: string;
      readonly reason_code: string;
      readonly decided_at: string;
    }>('seller_pricing_decisions', {
      select: 'seller_listing_id, action, reason_code, decided_at',
      gte: [['decided_at', decisionScanCutoff]],
      order: { column: 'decided_at', ascending: false },
    });

    const latestDecisionByListing = new Map<string, { action: string; reason_code: string; decided_at: string }>();
    for (const row of recentDecisions) {
      // First occurrence per listing wins because rows are sorted desc by decided_at.
      if (!latestDecisionByListing.has(row.seller_listing_id)) {
        latestDecisionByListing.set(row.seller_listing_id, {
          action: row.action,
          reason_code: row.reason_code,
          decided_at: row.decided_at,
        });
      }
    }
    const budgetFrozenIds: string[] = [];
    for (const [listingId, latest] of latestDecisionByListing) {
      if (
        latest.action === 'skipped'
        && latest.reason_code === 'budget_exhausted'
        && latest.decided_at < frozenCutoffBudget
      ) {
        budgetFrozenIds.push(listingId);
      }
    }

    let budgetFrozenListings: RawFrozenListingRow[] = [];
    if (budgetFrozenIds.length > 0) {
      budgetFrozenListings = await this.db.queryAll<RawFrozenListingRow>('seller_listings', {
        select: 'id, external_listing_id, price_cents, cost_basis_cents, currency, provider_account_id, variant_id, updated_at',
        eq: [
          ['status', 'active'],
          ['auto_sync_price', true],
        ],
        in: [['id', budgetFrozenIds]],
      });
    }

    // Merge both frozen sets (de-duped by listing id) and tag the reason.
    const frozenById = new Map<string, FrozenListingRow>();
    for (const r of belowCostFiltered) frozenById.set(r.id, { ...r, reason: 'below_cost' });
    for (const r of budgetFrozenListings) {
      const existing = frozenById.get(r.id);
      if (existing) {
        frozenById.set(r.id, { ...existing, reason: 'below_cost_and_budget_exhausted' });
      } else {
        frozenById.set(r.id, { ...r, reason: 'budget_exhausted' });
      }
    }

    // Resolve provider_code for human-readable alert metadata.
    const accountIds = [...new Set([...frozenById.values()].map((r) => r.provider_account_id).filter(Boolean))];
    const providerAccounts = accountIds.length
      ? await this.db.queryAll<{ id: string; provider_code: string }>('provider_accounts', {
          select: 'id, provider_code',
          in: [['id', accountIds]],
        })
      : [];
    const providerCodeById = new Map(providerAccounts.map((a) => [a.id, a.provider_code]));

    const openAlerts = await this.db.queryAll<{ id: string; metadata: Record<string, unknown> | null }>(
      'admin_alerts',
      {
        select: 'id, metadata',
        eq: [
          ['alert_type', SELLER_LISTING_PRICING_FROZEN_ALERT_TYPE],
          ['is_resolved', false],
        ],
      },
    );

    const openAlertsByListingId = new Map<string, { id: string; metadata: Record<string, unknown> | null }>();
    for (const alert of openAlerts) {
      const listingId = (alert.metadata?.listingId as string | undefined) ?? null;
      if (listingId) openAlertsByListingId.set(listingId, alert);
    }

    let alertsCreated = 0;
    for (const [listingId, frozen] of frozenById) {
      if (openAlertsByListingId.has(listingId)) continue;
      const providerCode = providerCodeById.get(frozen.provider_account_id) ?? null;
      await this.db.insert('admin_alerts', buildSellerListingPricingFrozenAlert(frozen, providerCode));
      alertsCreated += 1;
    }

    let alertsResolved = 0;
    const resolvedAt = new Date().toISOString();
    for (const [listingId, alert] of openAlertsByListingId) {
      if (frozenById.has(listingId)) continue;
      await this.db.update(
        'admin_alerts',
        { id: alert.id },
        { is_read: true, is_resolved: true, resolved_at: resolvedAt },
      );
      alertsResolved += 1;
    }

    logger.info('Synced seller_listing_pricing_frozen alerts', {
      frozenListingCount: frozenById.size,
      alertsCreated,
      alertsResolved,
    });

    return {
      alertsCreated,
      alertsResolved,
      frozenListingCount: frozenById.size,
    };
  }
}

const SELLER_LISTING_PAUSED_ALERT_TYPE = 'seller_listing_paused';
const SELLER_LISTING_PRICING_FROZEN_ALERT_TYPE = 'seller_listing_pricing_frozen';
/** Listings stuck on `budget_exhausted` for this many hours surface as alerts. */
const FROZEN_BUDGET_HOURS = 6;
/** Listings priced below cost-basis for this many hours surface as alerts. */
const FROZEN_BELOW_COST_HOURS = 1;
const PAUSED_STATES: string[] = ['paused', 'failed', 'error'];
/** Reservation circuit-breaker tripped at this consecutive-failure count → escalate severity. */
const CRITICAL_RESERVATION_FAILURE_FLOOR = 2;

interface RawPausedListingRow {
  readonly id: string;
  readonly external_listing_id: string | null;
  readonly status: string;
  readonly error_message: string | null;
  readonly reservation_consecutive_failures: number | null;
  readonly provider_account_id: string;
  readonly variant_id: string;
}

interface PausedListingRow extends Omit<RawPausedListingRow, 'provider_account_id'> {
  readonly provider_code: string | null;
}

interface OpenSellerPausedAlertRow {
  readonly id: string;
  readonly metadata: Record<string, unknown> | null;
}

interface RawFrozenListingRow {
  readonly id: string;
  readonly external_listing_id: string | null;
  readonly price_cents: number;
  readonly cost_basis_cents: number;
  readonly currency: string;
  readonly provider_account_id: string;
  readonly variant_id: string;
  readonly updated_at: string;
}

interface FrozenListingRow extends RawFrozenListingRow {
  readonly reason: 'budget_exhausted' | 'below_cost' | 'below_cost_and_budget_exhausted';
}

function buildSellerListingPricingFrozenAlert(
  listing: FrozenListingRow,
  providerCode: string | null,
): Record<string, unknown> {
  const providerLabel = providerCode ?? 'marketplace';
  const reasonText =
    listing.reason === 'budget_exhausted'
      ? `Pricing cron has been blocked by budget_exhausted for ≥${FROZEN_BUDGET_HOURS} h`
      : listing.reason === 'below_cost'
        ? `Listing has been priced below cost (price ${listing.price_cents}${listing.currency} < cost ${listing.cost_basis_cents}${listing.currency}) for ≥${FROZEN_BELOW_COST_HOURS} h`
        : `Listing is below cost AND pricing cron is budget_exhausted for ≥${FROZEN_BUDGET_HOURS} h`;

  return {
    alert_type: SELLER_LISTING_PRICING_FROZEN_ALERT_TYPE,
    severity: 'high',
    title: `${providerLabel} listing pricing frozen`,
    message: `Listing ${listing.external_listing_id ?? listing.id} (${providerLabel}): ${reasonText}.`,
    metadata: {
      listingId: listing.id,
      externalListingId: listing.external_listing_id,
      providerCode,
      variantId: listing.variant_id,
      currency: listing.currency,
      priceCents: listing.price_cents,
      costBasisCents: listing.cost_basis_cents,
      reason: listing.reason,
      lastUpdatedAt: listing.updated_at,
    },
    requires_action: true,
    priority: 2,
  };
}

function buildSellerListingPausedAlert(listing: PausedListingRow): Record<string, unknown> {
  const consecutive = listing.reservation_consecutive_failures ?? 0;
  const severity = consecutive >= CRITICAL_RESERVATION_FAILURE_FLOOR ? 'critical' : 'high';
  const providerLabel = listing.provider_code ?? 'marketplace';
  const reason = listing.error_message?.trim()
    ? listing.error_message.trim()
    : `Listing was auto-${listing.status} and needs operator review`;

  return {
    alert_type: SELLER_LISTING_PAUSED_ALERT_TYPE,
    severity,
    title: `${providerLabel} listing needs recovery`,
    message: `Listing ${listing.external_listing_id ?? listing.id} (${providerLabel}) is ${listing.status}. ${reason}`,
    metadata: {
      listingId: listing.id,
      externalListingId: listing.external_listing_id,
      providerCode: listing.provider_code,
      variantId: listing.variant_id,
      status: listing.status,
      errorMessage: listing.error_message,
      reservationConsecutiveFailures: consecutive,
    },
    requires_action: true,
    priority: severity === 'critical' ? 1 : 2,
  };
}
