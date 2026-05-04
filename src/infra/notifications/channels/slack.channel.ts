import type { IDatabase } from '../../../core/ports/database.port.js';
import type { AdminEvent, NotificationChannel } from '../../../core/ports/notification-channel.port.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('SlackChannel');

interface SlackConfig {
  readonly enabled: boolean;
  readonly webhook_url: string;
}

const SEVERITY_EMOJI: Record<string, string> = {
  info: ':information_source:',
  warning: ':warning:',
  critical: ':rotating_light:',
};

export class SlackChannel implements NotificationChannel {
  readonly name = 'slack';

  private cachedConfig: SlackConfig | null = null;
  private configFetchedAt = 0;
  private static readonly CONFIG_TTL_MS = 60_000;

  constructor(private readonly db: IDatabase) {}

  shouldNotify(_event: AdminEvent): boolean {
    return true;
  }

  async notify(event: AdminEvent): Promise<void> {
    const config = await this.getConfig();
    if (!config?.enabled || !config.webhook_url) return;

    const emoji = SEVERITY_EMOJI[event.severity] ?? '';
    const actor = event.actor.email ?? event.actor.id;
    const text = `${emoji} *${event.type}* (${event.severity})\nActor: ${actor}\n${this.formatPayload(event.payload)}`;

    try {
      const response = await fetch(config.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) {
        logger.error('Slack webhook returned non-OK status', {
          status: String(response.status),
          eventType: event.type,
        });
      }
    } catch (err) {
      logger.error('Failed to post to Slack', {
        error: String(err),
        eventType: event.type,
      });
    }
  }

  private async getConfig(): Promise<SlackConfig | null> {
    const now = Date.now();
    if (this.cachedConfig && now - this.configFetchedAt < SlackChannel.CONFIG_TTL_MS) {
      return this.cachedConfig;
    }

    try {
      const row = await this.db.queryOne<{ value: SlackConfig }>('platform_settings', {
        eq: [['key', 'admin_notification_config']],
      });

      if (row?.value) {
        this.cachedConfig = {
          enabled: Boolean(row.value.enabled),
          webhook_url: String(row.value.webhook_url ?? ''),
        };
      } else {
        this.cachedConfig = { enabled: false, webhook_url: '' };
      }
      this.configFetchedAt = now;
    } catch (err) {
      logger.error('Failed to fetch Slack config', { error: String(err) });
      this.cachedConfig = { enabled: false, webhook_url: '' };
      this.configFetchedAt = now;
    }
    return this.cachedConfig;
  }

  private formatPayload(payload: Record<string, unknown>): string {
    const entries = Object.entries(payload).slice(0, 5);
    return entries
      .map(([k, v]) => `• ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join('\n');
  }
}
