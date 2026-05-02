import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminVerificationRepository } from '../../core/ports/admin-verification-repository.port.js';
import type {
  ApproveVerificationDto,
  ApproveVerificationResult,
  DenyVerificationDto,
  DenyVerificationResult,
} from '../../core/use-cases/verification/verification.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminVerificationRepository');

@injectable()
export class SupabaseAdminVerificationRepository implements IAdminVerificationRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async approveVerification(dto: ApproveVerificationDto): Promise<ApproveVerificationResult> {
    logger.info('Approving verification', { verificationId: dto.verification_id, adminId: dto.admin_id });

    await this.db.rpc('record_verification_attempt', {
      p_verification_id: dto.verification_id,
      p_admin_id: dto.admin_id,
      p_status: 'approved',
      p_reason: null,
    });

    return { success: true };
  }

  async denyVerification(dto: DenyVerificationDto): Promise<DenyVerificationResult> {
    logger.info('Denying verification', { verificationId: dto.verification_id, adminId: dto.admin_id });

    await this.db.rpc('record_verification_attempt', {
      p_verification_id: dto.verification_id,
      p_admin_id: dto.admin_id,
      p_status: 'denied',
      p_reason: dto.reason,
    });

    return { success: true };
  }
}
