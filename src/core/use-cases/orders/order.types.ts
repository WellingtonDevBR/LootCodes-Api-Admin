// ── Fulfill Verified Order ──────────────────────────────────────────
export interface FulfillVerifiedOrderDto {
  order_id: string;
  admin_id: string;
}

export interface FulfillVerifiedOrderResult {
  success: boolean;
  order_id: string;
  keys_delivered?: number;
}

// ── Manual Fulfill ─────────────────────────────────────────────────
export interface ManualFulfillDto {
  order_id: string;
  admin_id: string;
  reason?: string;
}

export interface ManualFulfillResult {
  success: boolean;
  order_id: string;
}

// ── Recover Order ──────────────────────────────────────────────────
export interface RecoverOrderDto {
  order_id: string;
  admin_id: string;
}

export interface RecoverOrderResult {
  success: boolean;
  order_id: string;
  new_status: string;
}

// ── Confirm Payment ────────────────────────────────────────────────
export interface ConfirmPaymentDto {
  order_id: string;
  admin_id: string;
}

export interface ConfirmPaymentResult {
  success: boolean;
  order_id: string;
}

// ── Process Pre-order ──────────────────────────────────────────────
export interface ProcessPreorderDto {
  order_id: string;
  admin_id: string;
}

export interface ProcessPreorderResult {
  success: boolean;
}

// ── Generate Guest Access Link ─────────────────────────────────────
export interface GenerateGuestAccessLinkDto {
  order_id: string;
  admin_id: string;
}

export interface GenerateGuestAccessLinkResult {
  link: string;
  token: string;
  expires_at: string;
}

// ── Refund Order ───────────────────────────────────────────────────
export interface RefundOrderDto {
  order_id: string;
  admin_id: string;
  reason: string;
  amount_cents?: number;
}

export interface RefundOrderResult {
  success: boolean;
  refund_id?: string;
  amount_refunded_cents: number;
}

// ── Refund Ticket ──────────────────────────────────────────────────
export interface RefundTicketDto {
  ticket_id: string;
  admin_id: string;
  reason: string;
}

export interface RefundTicketResult {
  success: boolean;
  refund_id?: string;
}

// ── Refund Initiate ────────────────────────────────────────────────
export interface RefundInitiateDto {
  order_id: string;
  amount_cents: number;
  reason: string;
}

export interface RefundInitiateResult {
  success: boolean;
  refund_id?: string;
}

// ── Reissue Email ──────────────────────────────────────────────────
export interface ReissueEmailDto {
  order_id: string;
  admin_id: string;
  email_type: string;
}

export interface ReissueEmailResult {
  success: boolean;
}

// ── List Orders ────────────────────────────────────────────────────
export interface ListOrdersDto {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
  from?: string;
  to?: string;
}

export interface ListOrdersResult {
  orders: unknown[];
  total: number;
  page: number;
}

// ── Get Order Detail ───────────────────────────────────────────────
export interface GetOrderDetailDto {
  order_id: string;
}

export type GetOrderDetailResult = unknown;
