/**
 * Pure functions for parsing/validating Eneba declared stock callback
 * payloads and building Eneba-shaped responses.
 *
 * Port of Edge Function `seller-webhook/eneba-parser.ts`.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Types ───────────────────────────────────────────────────────────

export type EnebaCallbackAction = 'RESERVE' | 'PROVIDE' | 'CANCEL';

/**
 * Eneba key-replacement RESERVE: sent when a buyer reports a faulty key.
 * Flat format (no auctions array) — auctionId is the external_listing_id,
 * keyId is Eneba's internal reference to the previously-delivered key.
 */
export interface EnebaKeyReplacementPayload {
  action: 'RESERVE';
  isReplacement: true;
  orderId: string;
  originalOrderId: string | null;
  auctionId: string;
  enebaKeyId: string;
}

export interface EnebaCallbackMoney {
  amount: string | number;
  currency: string;
}

export interface EnebaCallbackAuction {
  auctionId: string;
  keyCount: number;
  price: EnebaCallbackMoney;
  originalPrice?: EnebaCallbackMoney;
  priceWithoutCommission?: EnebaCallbackMoney;
  campaignFee?: EnebaCallbackMoney;
  substituteAuctionFee?: EnebaCallbackMoney;
  extraInfo?: string;
}

export interface EnebaStandardCallbackPayload {
  action: EnebaCallbackAction;
  isReplacement?: false;
  orderId: string;
  originalOrderId: string | null;
  auctions?: EnebaCallbackAuction[];
  wholesale?: boolean;
}

/** Discriminated union — check `isReplacement` to narrow the type. */
export type EnebaCallbackPayload = EnebaStandardCallbackPayload | EnebaKeyReplacementPayload;

// ─── Response Types ──────────────────────────────────────────────────

export interface EnebaReservationResponse {
  action: 'RESERVE';
  orderId: string;
  success: boolean;
}

export interface EnebaKeyResponse {
  type: 'TEXT';
  value: string;
}

export interface EnebaAuctionKeysResponse {
  auctionId: string;
  keys: EnebaKeyResponse[];
}

export interface EnebaProvisionResponse {
  action: 'PROVIDE';
  orderId: string;
  success: boolean;
  auctions?: EnebaAuctionKeysResponse[];
}

// ─── Parse Error ─────────────────────────────────────────────────────

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

// ─── Parser ──────────────────────────────────────────────────────────

export function parseCallbackPayload(body: unknown): EnebaCallbackPayload {
  // Returns EnebaKeyReplacementPayload for flat replacement RESERVE,
  // or EnebaStandardCallbackPayload for normal RESERVE/PROVIDE/CANCEL.
  if (!body || typeof body !== 'object') {
    throw new ParseError('Invalid request body');
  }

  const raw = body as Record<string, unknown>;

  const action = raw.action;
  if (action !== 'RESERVE' && action !== 'PROVIDE' && action !== 'CANCEL') {
    throw new ParseError(`Unknown action: ${String(action)}`);
  }

  const orderId = raw.orderId;
  if (typeof orderId !== 'string' || !UUID_RE.test(orderId)) {
    throw new ParseError(`Invalid orderId: ${String(orderId)}`);
  }

  const originalOrderId = raw.originalOrderId != null
    ? String(raw.originalOrderId)
    : null;

  let auctions: EnebaCallbackAuction[] | undefined;
  if (action === 'RESERVE') {
    if (!Array.isArray(raw.auctions) || raw.auctions.length === 0) {
      // Flat key-replacement format: auctionId (external_listing_id) + keyId (Eneba's key ref)
      if (
        typeof raw.auctionId === 'string' && UUID_RE.test(raw.auctionId) &&
        typeof raw.keyId === 'string'
      ) {
        return {
          action: 'RESERVE',
          isReplacement: true,
          orderId,
          originalOrderId,
          auctionId: raw.auctionId,
          enebaKeyId: raw.keyId,
        } satisfies EnebaKeyReplacementPayload;
      }
      throw new ParseError('RESERVE requires non-empty auctions array');
    }
    auctions = raw.auctions.map(parseAuction);
  }

  const wholesale = typeof raw.wholesale === 'boolean' ? raw.wholesale : undefined;

  return { action, orderId, originalOrderId, auctions, wholesale } satisfies EnebaStandardCallbackPayload;
}

// ─── Internal helpers ────────────────────────────────────────────────

function parseRequiredMoney(raw: unknown, label: string): EnebaCallbackMoney {
  if (!raw || typeof raw !== 'object') {
    throw new ParseError(`Missing ${label}`);
  }
  const p = raw as Record<string, unknown>;
  const currency = p.currency != null ? String(p.currency).trim() : '';
  const amount = p.amount;
  if (!currency || (typeof amount !== 'string' && typeof amount !== 'number')) {
    throw new ParseError(
      `Invalid ${label}: amount=${String(amount)}, currency=${String(p.currency)}`,
    );
  }
  return { amount, currency };
}

function parseOptionalMoney(raw: unknown): EnebaCallbackMoney | undefined {
  if (raw == null || typeof raw !== 'object') return undefined;
  const p = raw as Record<string, unknown>;
  const currency = p.currency != null ? String(p.currency).trim() : '';
  const amount = p.amount;
  if (!currency || (typeof amount !== 'string' && typeof amount !== 'number')) {
    return undefined;
  }
  return { amount, currency };
}

function normalizeExtraInfo(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? raw : undefined;
  }
  if (typeof raw === 'object') {
    try {
      const s = JSON.stringify(raw);
      return s.length > 0 ? s : undefined;
    } catch {
      throw new ParseError('Invalid extraInfo: not serializable');
    }
  }
  throw new ParseError('Invalid extraInfo: expected string or structured value');
}

function parseAuction(raw: unknown): EnebaCallbackAuction {
  if (!raw || typeof raw !== 'object') {
    throw new ParseError('Invalid auction entry');
  }

  const a = raw as Record<string, unknown>;

  const auctionId = a.auctionId;
  if (typeof auctionId !== 'string' || !UUID_RE.test(auctionId)) {
    throw new ParseError(`Invalid auctionId: ${String(auctionId)}`);
  }

  const keyCount = Number(a.keyCount);
  if (!Number.isInteger(keyCount) || keyCount < 1) {
    throw new ParseError(`Invalid keyCount: ${String(a.keyCount)}`);
  }

  const price = parseRequiredMoney(a.price, 'auction price');
  const originalPrice = parseOptionalMoney(a.originalPrice);
  const priceWithoutCommission = parseOptionalMoney(a.priceWithoutCommission);
  const campaignFee = parseOptionalMoney(a.campaignFee);
  const substituteAuctionFee = parseOptionalMoney(a.substituteAuctionFee);
  const extraInfo = normalizeExtraInfo(a.extraInfo);

  const auction: EnebaCallbackAuction = { auctionId, keyCount, price };
  if (originalPrice) auction.originalPrice = originalPrice;
  if (priceWithoutCommission) auction.priceWithoutCommission = priceWithoutCommission;
  if (campaignFee) auction.campaignFee = campaignFee;
  if (substituteAuctionFee) auction.substituteAuctionFee = substituteAuctionFee;
  if (extraInfo !== undefined) auction.extraInfo = extraInfo;

  return auction;
}

// ─── Response Builders ───────────────────────────────────────────────

export function buildReservationResponse(
  orderId: string,
  success: boolean,
): EnebaReservationResponse {
  return { action: 'RESERVE', orderId, success };
}

export function buildProvisionResponse(
  orderId: string,
  success: boolean,
  auctions?: EnebaAuctionKeysResponse[],
): EnebaProvisionResponse {
  const response: EnebaProvisionResponse = {
    action: 'PROVIDE',
    orderId,
    success,
  };
  if (success && auctions) {
    response.auctions = auctions;
  }
  return response;
}

export function buildAuctionKeysResponse(
  auctionId: string,
  keys: EnebaKeyResponse[],
): EnebaAuctionKeysResponse {
  return { auctionId, keys };
}

export function buildTextKey(value: string): EnebaKeyResponse {
  return { type: 'TEXT', value };
}
