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
    const pausedListings = await this.db.queryAll<PausedListingRow>('seller_listings', {
      select: 'id, external_listing_id, status, error_message, reservation_consecutive_failures, provider_code, variant_id',
      in: [['status', PAUSED_STATES]],
    });

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
}

const SELLER_LISTING_PAUSED_ALERT_TYPE = 'seller_listing_paused';
const PAUSED_STATES: string[] = ['paused', 'failed', 'error'];
/** Reservation circuit-breaker tripped at this consecutive-failure count → escalate severity. */
const CRITICAL_RESERVATION_FAILURE_FLOOR = 2;

interface PausedListingRow {
  readonly id: string;
  readonly external_listing_id: string | null;
  readonly status: string;
  readonly error_message: string | null;
  readonly reservation_consecutive_failures: number | null;
  readonly provider_code: string | null;
  readonly variant_id: string;
}

interface OpenSellerPausedAlertRow {
  readonly id: string;
  readonly metadata: Record<string, unknown> | null;
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
    priority: severity === 'critical' ? 90 : 60,
  };
}
