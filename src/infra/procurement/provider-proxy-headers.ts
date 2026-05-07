/**
 * Optional request signing for provider proxy hops (parity with Edge `buildProviderProxyHeaders`).
 */
import { createHmac } from 'node:crypto';
import { getOptionalEnvVar } from '../../config/env.js';

export async function buildProviderProxyHeaders(rawBody: string): Promise<Record<string, string>> {
  const sharedSecret = getOptionalEnvVar('PROVIDER_PROXY_SHARED_SECRET');
  if (!sharedSecret) return {};

  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = `${rawBody}.${timestamp}`;
  const signature = createHmac('sha256', sharedSecret).update(payload).digest('hex');

  return {
    'x-ts': timestamp,
    'x-signature': signature,
  };
}
