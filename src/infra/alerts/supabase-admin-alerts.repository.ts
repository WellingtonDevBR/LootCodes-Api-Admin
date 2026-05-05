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
}
