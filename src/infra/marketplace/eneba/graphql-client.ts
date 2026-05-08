/**
 * Eneba GraphQL transport layer.
 *
 * Owns HTTP communication, token-expired retry, rate limiting tuned to
 * Eneba's 5 000 req / 10 min global cap, and batched-operation support.
 *
 * Does NOT know about domain concepts — purely a GraphQL transport.
 */
import { createLogger } from '../../../shared/logger.js';
import type { MarketplaceHttpClient } from '../_shared/marketplace-http.js';
import type { OAuth2TokenManager } from '../_shared/marketplace-http.js';
import type {
  EnebaGraphQLResponse,
  EnebaGraphQLError,
  BatchOperation,
} from './types.js';
import { buildBatchBody } from './queries.js';

const logger = createLogger('eneba-graphql-client');

/**
 * Thrown when Eneba returns USER_ERROR "Too many results".
 * Callers should catch this to stop pagination gracefully and keep
 * whatever results were already collected.
 */
export class EnebaTooManyResultsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnebaTooManyResultsError';
  }
}

// ─── Sliding Window Rate Limiter ─────────────────────────────────────

class SlidingWindowRateLimiter {
  private timestamps: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  canProceed(): boolean {
    this.prune();
    return this.timestamps.length < this.max;
  }

  record(): void {
    this.timestamps.push(Date.now());
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
  }
}

// ─── Client ──────────────────────────────────────────────────────────

export interface EnebaGraphQLClientConfig {
  baseUrl: string;
  /** Safety margin below Eneba's 5 000 / 10 min hard limit. Default: 4500. */
  maxRequestsPerWindow?: number;
  /** Rate limit window in milliseconds. Default: 600_000 (10 min). */
  windowMs?: number;
}

export class EnebaGraphQLClient {
  private readonly httpClient: MarketplaceHttpClient;
  private readonly tokenManager: OAuth2TokenManager;
  private readonly baseUrl: string;
  private readonly rl: SlidingWindowRateLimiter;

  constructor(
    httpClient: MarketplaceHttpClient,
    tokenManager: OAuth2TokenManager,
    config: EnebaGraphQLClientConfig,
  ) {
    this.httpClient = httpClient;
    this.tokenManager = tokenManager;
    this.baseUrl = config.baseUrl;
    this.rl = new SlidingWindowRateLimiter(
      config.maxRequestsPerWindow ?? 4500,
      config.windowMs ?? 600_000,
    );
  }

  /**
   * Execute a single GraphQL operation. Retries once on 401 (expired token).
   */
  async execute<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const operationMatch = query.match(/(?:query|mutation)\s+(\w+)/);
    const opName = operationMatch?.[1] ?? 'unknown';

    const body = { query, variables };

    let raw: EnebaGraphQLResponse<T>;
    try {
      raw = await this.send<EnebaGraphQLResponse<T>>(body);
    } catch (err) {
      if (err instanceof Error && err.message.includes('401')) {
        logger.info('Eneba token expired — refreshing and retrying');
        this.tokenManager.loadFromCache(null);
        raw = await this.send<EnebaGraphQLResponse<T>>(body);
      } else {
        throw err;
      }
    }

    if (raw.errors?.length) {
      const errText = raw.errors.map((e) => e.message).join('; ');
      const isRateLimit = /too many requests|rate.?limit|retry after/i.test(errText);
      const logFn = isRateLimit ? logger.info.bind(logger) : logger.warn.bind(logger);
      logFn('GraphQL response has errors', { operation: opName, errors: errText });
    }

    this.throwOnGraphQLErrors(raw.errors);
    return raw.data as T;
  }

  /**
   * Execute multiple named operations in a single HTTP request (Eneba batch).
   * Returns a map keyed by operation name.
   */
  async executeBatch<T = unknown>(
    operations: BatchOperation[],
  ): Promise<Map<string, T>> {
    if (operations.length === 0) return new Map();

    const batchPayload = buildBatchBody(operations);

    let rawArray: Array<EnebaGraphQLResponse<T>>;
    try {
      rawArray = await this.send<Array<EnebaGraphQLResponse<T>>>(batchPayload);
    } catch (err) {
      if (err instanceof Error && err.message.includes('401')) {
        logger.info('Eneba token expired on batch — refreshing and retrying');
        this.tokenManager.loadFromCache(null);
        rawArray = await this.send<Array<EnebaGraphQLResponse<T>>>(batchPayload);
      } else {
        throw err;
      }
    }

    const results = new Map<string, T>();
    for (let i = 0; i < operations.length; i++) {
      const entry = rawArray[i];
      if (!entry) continue;

      if (entry.errors?.length) {
        const errText = entry.errors.map((e) => e.message).join('; ');
        const isRateLimit = /too many requests|rate.?limit|retry after/i.test(errText);
        const logFn = isRateLimit ? logger.info.bind(logger) : logger.warn.bind(logger);
        logFn('Batch operation had errors', { operationName: operations[i].name, errors: errText });
        continue;
      }
      if (entry.data != null) {
        results.set(operations[i].name, entry.data);
      }
    }
    return results;
  }

  private async send<T>(body: unknown): Promise<T> {
    if (!this.rl.canProceed()) {
      throw new Error('Eneba rate limit exhausted (4500 req / 10 min)');
    }
    this.rl.record();

    return this.httpClient.post<T>(this.baseUrl, body, {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private throwOnGraphQLErrors(errors?: EnebaGraphQLError[]): void {
    if (!errors?.length) return;

    const messages = errors.map((e) => e.message);
    const firstCode = errors[0]?.extensions?.code ?? 'UNKNOWN';

    if (
      firstCode === 'USER_ERROR' &&
      messages.some((m) => /too many results/i.test(m))
    ) {
      throw new EnebaTooManyResultsError(messages.join('; '));
    }

    throw new Error(`Eneba GraphQL error [${firstCode}]: ${messages.join('; ')}`);
  }
}
