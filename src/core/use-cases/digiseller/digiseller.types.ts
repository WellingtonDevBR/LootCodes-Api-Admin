export interface DigisellerReconcileProfitDto { order_id?: string; date_range?: { from: string; to: string }; admin_id: string }
export interface DigisellerReconcileProfitResult { success: boolean; orders_reconciled: number; total_profit_cents: number }
