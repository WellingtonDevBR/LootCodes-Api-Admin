import { MarketplaceHttpClient } from '../_shared/marketplace-http.js';

/**
 * @param rateLimiter — Pass `{ maxRequests: 2, windowMs: 60_000 }` for `GET /services`-heavy flows.
 *   Omit for order endpoints where polling needs a higher throughput ceiling.
 */
export function createAppRouteMarketplaceHttpClient(params: {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly rateLimiter?: { readonly maxRequests: number; readonly windowMs: number };
}): MarketplaceHttpClient {
  const apiKey = params.apiKey.trim();
  return new MarketplaceHttpClient({
    baseUrl: params.baseUrl.replace(/\/$/, ''),
    providerCode: 'approute',
    timeoutMs: 30_000,
    ...(params.rateLimiter ? { rateLimiter: params.rateLimiter } : {}),
    retry: { maxRetries: 1, baseDelayMs: 2_000, maxDelayMs: 15_000 },
    headers: async () => ({
      'X-API-Key': apiKey,
    }),
  });
}
