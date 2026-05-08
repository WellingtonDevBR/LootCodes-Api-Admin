/**
 * Port: platform-wide runtime settings read by orchestrators (e.g. cron jobs).
 *
 * Today the only consumer is the seller-listings cron orchestrator, which
 * checks `fulfillment_mode` to decide whether to pause maintenance work.
 */
export type FulfillmentMode = 'auto' | 'hold_new_cards' | 'hold_all';

export interface IPlatformSettingsPort {
  /**
   * Reads `platform_settings.value->>'mode'` from the row keyed
   * `fulfillment_mode`. Returns `'auto'` when the row is missing or the
   * stored shape does not match a known mode.
   */
  getFulfillmentMode(): Promise<FulfillmentMode>;
}
