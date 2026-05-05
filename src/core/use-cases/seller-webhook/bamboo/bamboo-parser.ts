/**
 * Bamboo callback payload parsing and validation.
 *
 * Bamboo sends a JSON POST when an order reaches a terminal state.
 * Unlike HMAC-based providers, Bamboo includes the secretKey directly
 * in the JSON body for verification.
 *
 * Key difference: Bamboo callbacks do NOT include keys/cards.
 * After verifying a success callback, the handler must fetch keys
 * from the Orders API separately.
 */
export interface BambooNotificationCallbackPayload {
  orderId: number;
  status: string;
  totalCards: number;
  createdOn: string;
  completedOn: string;
  secretKey: string;
  requestId: string;
}

export class BambooParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BambooParseError';
  }
}

export function parseBambooCallbackPayload(body: unknown): BambooNotificationCallbackPayload {
  if (!body || typeof body !== 'object') {
    throw new BambooParseError('Bamboo callback body must be a non-null object');
  }

  const data = body as Record<string, unknown>;

  if (typeof data.requestId !== 'string' || !data.requestId) {
    throw new BambooParseError('Missing or invalid requestId in Bamboo callback');
  }

  if (typeof data.status !== 'string' || !data.status) {
    throw new BambooParseError('Missing or invalid status in Bamboo callback');
  }

  if (typeof data.secretKey !== 'string') {
    throw new BambooParseError('Missing secretKey in Bamboo callback');
  }

  return {
    orderId: typeof data.orderId === 'number' ? data.orderId : 0,
    status: data.status,
    totalCards: typeof data.totalCards === 'number' ? data.totalCards : 0,
    createdOn: typeof data.createdOn === 'string' ? data.createdOn : '',
    completedOn: typeof data.completedOn === 'string' ? data.completedOn : '',
    secretKey: data.secretKey,
    requestId: data.requestId,
  };
}

export function normalizeBambooStatus(status: string): 'success' | 'failed' | 'pending' {
  const lower = status.toLowerCase();
  if (lower === 'succeeded') return 'success';
  if (lower === 'failed' || lower === 'cancelled' || lower === 'canceled') return 'failed';
  if (lower === 'partialfailed') return 'success';
  return 'pending';
}
