import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminSupportRepository } from '../../core/ports/admin-support-repository.port.js';
import type {
  UpdateTicketStatusDto,
  UpdateTicketStatusResult,
} from '../../core/use-cases/support/support.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminSupportRepository');

@injectable()
export class SupabaseAdminSupportRepository implements IAdminSupportRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async updateTicketStatus(dto: UpdateTicketStatusDto): Promise<UpdateTicketStatusResult> {
    logger.info('Updating ticket status', { ticketId: dto.ticket_id, status: dto.status, adminId: dto.admin_id });

    const updateData: Record<string, unknown> = {
      status: dto.status,
      updated_by: dto.admin_id,
      updated_at: new Date().toISOString(),
    };

    if (dto.note) {
      updateData.admin_note = dto.note;
    }

    await this.db.update('support_tickets', { id: dto.ticket_id }, updateData);

    return { success: true };
  }
}
