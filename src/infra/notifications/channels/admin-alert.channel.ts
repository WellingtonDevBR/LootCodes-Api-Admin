import type { IDatabase } from '../../../core/ports/database.port.js';
import type { AdminEvent, NotificationChannel } from '../../../core/ports/notification-channel.port.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('AdminAlertChannel');

const EVENT_TITLE_MAP: Record<string, string> = {
  'keys.bulk_decrypt': 'Bulk Key Decryption',
  'keys.bulk_download': 'Bulk Key Download',
  'keys.manual_sale': 'Manual Sale Executed',
  'keys.sales_blocked': 'Key Sales Blocked',
  'security.suspicious_activity': 'Suspicious Activity Detected',
  'inventory.stock_critical': 'Critical Stock Level',
};

export class AdminAlertChannel implements NotificationChannel {
  readonly name = 'admin_alerts';

  constructor(private readonly db: IDatabase) {}

  shouldNotify(event: AdminEvent): boolean {
    return event.severity === 'warning' || event.severity === 'critical';
  }

  async notify(event: AdminEvent): Promise<void> {
    try {
      await this.db.insert('admin_alerts', {
        alert_type: event.type,
        severity: event.severity,
        title: EVENT_TITLE_MAP[event.type] ?? event.type,
        message: this.buildMessage(event),
        related_user_id: event.actor.id !== 'unknown' ? event.actor.id : null,
        metadata: {
          actor_email: event.actor.email,
          ...event.payload,
        },
        is_read: false,
        is_resolved: false,
        requires_action: event.severity === 'critical',
        priority: event.severity === 'critical' ? 1 : 2,
      });
    } catch (err) {
      logger.error('Failed to insert admin alert', { error: String(err), eventType: event.type });
    }
  }

  private buildMessage(event: AdminEvent): string {
    const actor = event.actor.email ?? event.actor.id;
    switch (event.type) {
      case 'keys.bulk_decrypt':
        return `${actor} decrypted ${event.payload.key_count ?? '?'} keys`;
      case 'keys.bulk_download':
        return `${actor} downloaded ${event.payload.key_count ?? '?'} keys`;
      case 'keys.manual_sale':
        return `${actor} executed a manual sale`;
      case 'keys.sales_blocked':
        return `${actor} blocked sales for keys`;
      case 'security.suspicious_activity':
        return `Suspicious activity detected for ${actor}`;
      case 'inventory.stock_critical':
        return `Stock is critically low for variant ${String(event.payload.variant_id ?? '?')}`;
      default:
        return `Admin event: ${event.type}`;
    }
  }
}
