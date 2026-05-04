import type { IDatabase } from '../../../core/ports/database.port.js';
import type { AdminEvent, NotificationChannel } from '../../../core/ports/notification-channel.port.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('EmailChannel');

export class EmailChannel implements NotificationChannel {
  readonly name = 'email';

  constructor(private readonly db: IDatabase) {}

  shouldNotify(event: AdminEvent): boolean {
    return event.severity === 'critical';
  }

  async notify(event: AdminEvent): Promise<void> {
    try {
      await this.db.insert('admin_alerts', {
        alert_type: event.type,
        severity: event.severity,
        title: `[EMAIL] ${event.type}`,
        message: `Critical event by ${event.actor.email ?? event.actor.id}: ${event.type}`,
        related_user_id: event.actor.id !== 'unknown' ? event.actor.id : null,
        metadata: {
          notify_email: true,
          actor_email: event.actor.email,
          ...event.payload,
        },
        is_read: false,
        is_resolved: false,
        requires_action: true,
        priority: 0,
      });
      // TODO: Wire up direct email sending via IEmailSender when available.
      // Currently relies on a cron job picking up admin_alerts with metadata.notify_email = true.
    } catch (err) {
      logger.error('Failed to queue email notification', {
        error: String(err),
        eventType: event.type,
      });
    }
  }
}
