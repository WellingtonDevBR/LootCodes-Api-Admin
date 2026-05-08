import { MarketplaceApiError } from '../_shared/marketplace-http.js';
import type { AppRouteEnvelopeShape } from './types.js';

export type AppRouteEnvelope<T = unknown> = AppRouteEnvelopeShape<T>;

export function formatAppRouteErrors(errors: readonly unknown[]): string {
  const parts: string[] = [];
  for (const e of errors) {
    if (e == null) continue;
    if (typeof e === 'string') {
      parts.push(e);
      continue;
    }
    if (typeof e === 'object' && !Array.isArray(e)) {
      const o = e as Record<string, unknown>;
      const code = typeof o.code === 'string' ? o.code : '';
      const message = typeof o.message === 'string' ? o.message : '';
      const slice = [code, message].filter(Boolean).join(': ');
      if (slice) parts.push(slice);
      else parts.push(JSON.stringify(o));
      continue;
    }
    parts.push(String(e));
  }
  return parts.join('; ');
}

export function parseAppRouteEnvelope(json: unknown): AppRouteEnvelope {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new MarketplaceApiError('AppRoute: response is not a JSON object', 'approute');
  }
  return json as AppRouteEnvelope;
}

/**
 * Normalizes AppRoute JSON envelopes (`status`, `statusCode`, `errors`, `data`) after HTTP success (2xx).
 */
export function assertAppRouteSuccess<T>(env: AppRouteEnvelope<T>): T {
  const errs = env.errors;
  if (Array.isArray(errs) && errs.length > 0) {
    const msg = formatAppRouteErrors(errs);
    throw new MarketplaceApiError(`AppRoute API error: ${msg}`, 'approute', env.statusCode, msg);
  }

  const code = env.statusCode;
  if (typeof code === 'number' && code >= 400) {
    throw new MarketplaceApiError(
      `AppRoute API error: ${env.statusMessage ?? String(code)}`,
      'approute',
      code,
    );
  }

  const st = typeof env.status === 'string' ? env.status.trim().toUpperCase() : '';
  if ((st === 'ERROR' || st === 'FAIL' || st === 'FAILED') && env.data === undefined) {
    throw new MarketplaceApiError(
      `AppRoute unsuccessful: ${env.statusMessage ?? st}`,
      'approute',
      code,
    );
  }

  return env.data as T;
}

export function isIdempotencyReplayError(text: string): boolean {
  return /\bIDEMPOTENCY_REPLAY\b/i.test(text);
}
