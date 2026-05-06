/**
 * Digiseller reconciliation DTOs.
 *
 * Three mutually exclusive modes (pass exactly one):
 *   - transaction_id: reconcile a single transaction by UUID
 *   - invoice_id: reconcile by Digiseller invoice number
 *   - all_missing: backfill all marketplace_sale rows with null seller_profit_cents
 */

export interface DigisellerReconcileProfitDto {
  transaction_id?: string;
  invoice_id?: string;
  all_missing?: boolean;
  limit?: number;
  since?: string;
  dry_run?: boolean;
  admin_id: string;
}

export type ReconcileChange = 'unchanged' | 'would_apply' | 'applied';

export interface ReconcileResultItem {
  transactionId: string;
  invoiceId: string;
  invoiceState: number;
  change: ReconcileChange;
  skippedReason?: string;
  before?: { feeCents: number | null; profitCents: number | null };
  after?: { feeCents: number; profitCents: number; ratio: number };
  info?: { invoiceState: number; lockState: string; nativeCurrency: string };
  error?: string;
}

export interface DigisellerReconcileProfitResult {
  ok: boolean;
  dry_run: boolean;
  processed: number;
  summary: Record<ReconcileChange | 'errored', number>;
  results: ReconcileResultItem[];
}

/**
 * Normalized snapshot of a Digiseller invoice from purchase/info API.
 */
export interface DigisellerOrderInfo {
  invoiceId: string;
  itemId: number | null;
  productName: string | null;
  amountNative: number;
  profitNative: number | null;
  agentFeeNative: number;
  amountUsd: number | null;
  nativeCurrencyCode: string;
  isoCurrencyCode: string | null;
  invoiceState: number;
  lockState: string;
  dayLock: number;
  datePay: string | null;
  purchaseDate: string | null;
  agentId: number | null;
  buyerEmail: string | null;
  raw: Record<string, unknown>;
}
