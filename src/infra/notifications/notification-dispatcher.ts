import { injectable } from 'tsyringe';
import type {
  AdminEvent,
  INotificationDispatcher,
  NotificationChannel,
} from '../../core/ports/notification-channel.port.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('NotificationDispatcher');

@injectable()
export class NotificationDispatcher implements INotificationDispatcher {
  private readonly channels: NotificationChannel[] = [];

  register(channel: NotificationChannel): void {
    this.channels.push(channel);
    logger.info(`Registered notification channel: ${channel.name}`);
  }

  async dispatch(event: AdminEvent): Promise<void> {
    const applicable = this.channels.filter(ch => ch.shouldNotify(event));
    if (applicable.length === 0) return;

    const results = await Promise.allSettled(
      applicable.map(ch => ch.notify(event)),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        logger.error(
          `Channel "${applicable[i].name}" failed for event ${event.type}`,
          { error: String(result.reason) },
        );
      }
    }
  }
}
