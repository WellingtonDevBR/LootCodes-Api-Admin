/**
 * Reads `platform_settings.fulfillment_mode` from Supabase.
 *
 * Strict: throws if the row is missing, malformed, or holds an unknown
 * mode. Operations that consume this port (cron orchestrators) must
 * fail loudly when platform configuration is wrong rather than
 * silently assuming a default mode.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { FulfillmentMode, IPlatformSettingsPort } from '../../core/ports/platform-settings.port.js';

const KNOWN_MODES: ReadonlySet<FulfillmentMode> = new Set<FulfillmentMode>([
  'auto',
  'hold_new_cards',
  'hold_all',
]);

interface FulfillmentModeRow {
  readonly value: unknown;
}

@injectable()
export class SupabasePlatformSettingsRepository implements IPlatformSettingsPort {
  constructor(@inject(TOKENS.Database) private readonly db: IDatabase) {}

  async getFulfillmentMode(): Promise<FulfillmentMode> {
    const row = await this.db.queryOne<FulfillmentModeRow>('platform_settings', {
      select: 'value',
      eq: [['key', 'fulfillment_mode']],
      maybeSingle: true,
    });

    if (row == null) {
      throw new Error(
        "platform_settings row 'fulfillment_mode' is missing — seed the row with a known mode (auto | hold_new_cards | hold_all)",
      );
    }
    if (row.value == null || typeof row.value !== 'object') {
      throw new Error(
        "platform_settings.fulfillment_mode.value must be an object of shape { mode: 'auto' | 'hold_new_cards' | 'hold_all' }",
      );
    }

    const mode = (row.value as Record<string, unknown>).mode;
    if (typeof mode !== 'string' || !KNOWN_MODES.has(mode as FulfillmentMode)) {
      throw new Error(
        `platform_settings.fulfillment_mode.value.mode is not a known mode: ${JSON.stringify(mode)}`,
      );
    }
    return mode as FulfillmentMode;
  }
}
