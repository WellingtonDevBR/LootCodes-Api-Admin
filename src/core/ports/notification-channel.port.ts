export type AdminEventType =
  | 'keys.bulk_decrypt'
  | 'keys.bulk_download'
  | 'keys.manual_sale'
  | 'keys.sales_blocked'
  | 'security.suspicious_activity'
  | 'inventory.stock_critical';

export type AdminEventSeverity = 'info' | 'warning' | 'critical';

export interface AdminEvent {
  readonly type: AdminEventType;
  readonly severity: AdminEventSeverity;
  readonly actor: { readonly id: string; readonly email: string | null };
  readonly payload: Record<string, unknown>;
  readonly timestamp: string;
}

export interface NotificationChannel {
  readonly name: string;
  shouldNotify(event: AdminEvent): boolean;
  notify(event: AdminEvent): Promise<void>;
}

export interface INotificationDispatcher {
  register(channel: NotificationChannel): void;
  dispatch(event: AdminEvent): Promise<void>;
}
