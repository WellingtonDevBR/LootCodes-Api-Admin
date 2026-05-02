import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminAuthSmsRepository } from '../../ports/admin-auth-sms-repository.port.js';
import type { VerifyAdminSmsDto, VerifyAdminSmsResult } from './admin-auth.types.js';

@injectable()
export class VerifyAdminSmsUseCase {
  constructor(
    @inject(TOKENS.AdminAuthSmsRepository) private repo: IAdminAuthSmsRepository,
  ) {}

  async execute(dto: VerifyAdminSmsDto): Promise<VerifyAdminSmsResult> {
    return this.repo.verifyAdminSms(dto);
  }
}
