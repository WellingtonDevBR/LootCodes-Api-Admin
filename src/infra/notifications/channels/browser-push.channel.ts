import type { IDatabase } from '../../../core/ports/database.port.js';
import type { AdminEvent, NotificationChannel } from '../../../core/ports/notification-channel.port.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('BrowserPushChannel');

export class BrowserPushChannel implements NotificationChannel {
  readonly name = 'browser_push';

  constructor(private readonly db: IDatabase) {}

  shouldNotify(_event: AdminEvent): boolean {
    return true;
  }

  async notify(event: AdminEvent): Promise<void> {
    try {
      const adminUsers = await this.db.query<{ user_id: string }>('user_roles', {
        select: 'user_id',
        eq: [['role', 'admin']],
      });

      if (adminUsers.length === 0) return;

      const title = this.formatTitle(event);
      const body = this.formatBody(event);

      await Promise.allSettled(
        adminUsers.map(admin =>
          this.db.insert('notifications_inbox', {
            user_id: admin.user_id,
            title,
            body,
            notification_type: 'admin_event',
            data: {
              event_type: event.type,
              severity: event.severity,
              actor_id: event.actor.id,
              ...event.payload,
            },
            read: false,
          }),
        ),
      );
    } catch (err) {
      logger.error('Failed to send browser push notifications', {
        error: String(err),
        eventType: event.type,
      });
    }
  }

  private formatTitle(event: AdminEvent): string {
    const severityPrefix = event.severity === 'critical' ? '[CRITICAL] ' : '';
    switch (event.type) {
      case 'keys.bulk_decrypt':
        return `${severityPrefix}Bulk Key Decryption`;
      case 'keys.bulk_download':
        return `${severityPrefix}Bulk Key Download`;
      case 'keys.manual_sale':
        return `${severityPrefix}Manual Sale`;
      case 'keys.sales_blocked':
        return `${severityPrefix}Sales Blocked`;
      case 'security.suspicious_activity':
        return `${severityPrefix}Suspicious Activity`;
      case 'inventory.stock_critical':
        return `${severityPrefix}Critical Stock`;
      default:
        return `${severityPrefix}Admin Event`;
    }
  }

  private formatBody(event: AdminEvent): string {
    const actor = event.actor.email ?? 'Unknown admin';
    const count = event.payload.key_count;
    switch (event.type) {
      case 'keys.bulk_decrypt':
        return `${actor} decrypted ${count ?? '?'} keys`;
      case 'keys.bulk_download':
        return `${actor} downloaded ${count ?? '?'} keys`;
      case 'keys.manual_sale':
        return `${actor} executed a manual sale`;
      default:
        return `Event: ${event.type} by ${actor}`;
    }
  }
}
