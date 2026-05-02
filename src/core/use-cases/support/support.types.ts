export interface UpdateTicketStatusDto { ticket_id: string; status: string; admin_id: string; note?: string }
export interface UpdateTicketStatusResult { success: boolean }
