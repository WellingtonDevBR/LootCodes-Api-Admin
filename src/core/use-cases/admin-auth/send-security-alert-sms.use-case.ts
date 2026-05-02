import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminAuthSmsRepository } from '../../ports/admin-auth-sms-repository.port.js';
import type { SendSecurityAlertSmsDto, SendSecurityAlertSmsResult } from './admin-auth.types.js';

@injectable()
export class SendSecurityAlertSmsUseCase {
  constructor(
    @inject(TOKENS.AdminAuthSmsRepository) private repo: IAdminAuthSmsRepository,
  ) {}

  async execute(dto: SendSecurityAlertSmsDto): Promise<SendSecurityAlertSmsResult> {
    return this.repo.sendSecurityAlertSms(dto);
  }
}
