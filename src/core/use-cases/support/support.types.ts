// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

export type TicketStatus = 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TicketType =
  | 'general'
  | 'key_not_working'
  | 'missing_key'
  | 'wrong_product'
  | 'activation_issue'
  | 'refund_request'
  | 'order_status'
  | 'payment_issue'
  | 'technical'
  | 'id_verification'
  | 'security_verification'
  | 'checkout_rate_limit';

export type SenderType = 'customer' | 'admin' | 'system';

// ---------------------------------------------------------------------------
// List tickets
// ---------------------------------------------------------------------------

export interface ListTicketsDto {
  search?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  limit: number;
  offset: number;
  admin_id: string;
}

export interface AdminTicketRow {
  id: string;
  ticket_number: string;
  ticket_type: TicketType;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  customer_name?: string;
  customer_email?: string;
  guest_email?: string;
  source?: string;
  source_channel?: string;
  user_id?: string;
  created_at: string;
  updated_at: string;
  resolved_at?: string;
  customer_feedback_rating?: number;
}

export interface TicketStats {
  open: number;
  in_progress: number;
  urgent: number;
  total: number;
}

export interface ListTicketsResult {
  tickets: AdminTicketRow[];
  total: number;
  stats: TicketStats;
}

// ---------------------------------------------------------------------------
// Get ticket detail
// ---------------------------------------------------------------------------

export interface GetTicketDto {
  ticket_number: string;
  admin_id: string;
}

export interface TicketOrderInfo {
  order_number: string;
  status: string;
  order_channel?: string;
  contact_email?: string;
  delivery_email?: string;
  guest_email?: string;
  fulfillment_status?: string;
  refund_status?: string;
  refunded_at?: string;
  refund_amount?: number;
  refund_reason?: string;
  total_amount: number;
  currency?: string;
}

export interface TicketAttachmentRow {
  id: string;
  file_name: string;
  file_url: string;
  file_size: number;
  mime_type: string;
  created_at: string;
}

export interface TicketMessageRow {
  id: string;
  ticket_id: string;
  sender_type: SenderType;
  sender_id?: string;
  sender_email?: string;
  sender_name: string;
  message: string;
  is_internal: boolean;
  created_at: string;
  attachments?: TicketAttachmentRow[];
}

export interface TicketAffectedKeyRow {
  id: string;
  product_key_id: string;
  is_faulty: boolean;
  issue_type?: string;
  replacement_key_id?: string;
  resolved_at?: string;
  admin_notes?: string;
  product_name?: string;
  platform_name?: string;
  region_name?: string;
  encrypted_key_preview?: string;
  created_at: string;
}

export interface SupportTicketDetail {
  id: string;
  ticket_number: string;
  user_id?: string;
  guest_email?: string;
  customer_email?: string;
  order_contact_email?: string;
  customer_name?: string;
  source?: string;
  source_channel?: string;
  subject: string;
  description: string;
  ticket_type: TicketType;
  status: TicketStatus;
  priority: TicketPriority;
  order_id?: string;
  order?: TicketOrderInfo;
  order_item_id?: string;
  product_key_id?: string;
  issue_context?: Record<string, unknown>;
  assigned_to?: string;
  created_at: string;
  updated_at: string;
  resolved_at?: string;
  first_response_at?: string;
  customer_feedback_rating?: number;
  customer_feedback_at?: string;
  metadata?: Record<string, unknown>;
  messages: TicketMessageRow[];
  affected_keys: TicketAffectedKeyRow[];
}

export interface GetTicketResult {
  ticket: SupportTicketDetail;
}

// ---------------------------------------------------------------------------
// Update ticket status (existing, expanded)
// ---------------------------------------------------------------------------

export interface UpdateTicketStatusDto {
  ticket_id: string;
  status: string;
  admin_id: string;
  note?: string;
}

export interface UpdateTicketStatusResult {
  success: boolean;
}

// ---------------------------------------------------------------------------
// Update ticket priority
// ---------------------------------------------------------------------------

export interface UpdateTicketPriorityDto {
  ticket_id: string;
  priority: string;
  admin_id: string;
}

export interface UpdateTicketPriorityResult {
  success: boolean;
}

// ---------------------------------------------------------------------------
// Add ticket message
// ---------------------------------------------------------------------------

export interface AddTicketMessageDto {
  ticket_id: string;
  message: string;
  sender_name: string;
  sender_email: string;
  is_internal?: boolean;
  admin_id: string;
}

export interface AddTicketMessageResult {
  success: boolean;
  message_id: string;
}

// ---------------------------------------------------------------------------
// Process ticket refund
// ---------------------------------------------------------------------------

export interface ProcessTicketRefundDto {
  ticket_id: string;
  order_id: string;
  refund_amount?: number;
  refund_reason?: string;
  affected_key_ids?: string[];
  mark_keys_as_faulty?: boolean;
  admin_id: string;
}

export interface ProcessTicketRefundResult {
  success: boolean;
}
