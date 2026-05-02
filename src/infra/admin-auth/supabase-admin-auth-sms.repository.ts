import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminAuthSmsRepository } from '../../core/ports/admin-auth-sms-repository.port.js';
import type {
  SendAdminSmsDto,
  SendAdminSmsResult,
  VerifyAdminSmsDto,
  VerifyAdminSmsResult,
  SendSecurityAlertSmsDto,
  SendSecurityAlertSmsResult,
} from '../../core/use-cases/admin-auth/admin-auth.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminAuthSmsRepository');

@injectable()
export class SupabaseAdminAuthSmsRepository implements IAdminAuthSmsRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async sendAdminSms(dto: SendAdminSmsDto): Promise<SendAdminSmsResult> {
    logger.info('Sending admin SMS OTP', { adminId: dto.admin_id });

    await this.db.rpc('admin_send_sms_otp', {
      p_phone: dto.phone,
      p_admin_id: dto.admin_id,
    });

    return { success: true };
  }

  async verifyAdminSms(dto: VerifyAdminSmsDto): Promise<VerifyAdminSmsResult> {
    logger.info('Verifying admin SMS OTP', { adminId: dto.admin_id });

    const result = await this.db.rpc<{ verified: boolean }>(
      'admin_verify_sms_otp',
      {
        p_phone: dto.phone,
        p_code: dto.code,
        p_admin_id: dto.admin_id,
      },
    );

    return {
      success: true,
      verified: result.verified,
    };
  }

  async sendSecurityAlertSms(dto: SendSecurityAlertSmsDto): Promise<SendSecurityAlertSmsResult> {
    logger.info('Sending security alert SMS', { severity: dto.severity });

    await this.db.rpc('admin_send_security_alert_sms', {
      p_message: dto.message,
      p_severity: dto.severity,
    });

    return { success: true };
  }
}
