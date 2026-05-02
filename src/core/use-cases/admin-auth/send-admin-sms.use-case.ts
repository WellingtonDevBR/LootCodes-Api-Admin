import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminAuthSmsRepository } from '../../ports/admin-auth-sms-repository.port.js';
import type { SendAdminSmsDto, SendAdminSmsResult } from './admin-auth.types.js';

@injectable()
export class SendAdminSmsUseCase {
  constructor(
    @inject(TOKENS.AdminAuthSmsRepository) private repo: IAdminAuthSmsRepository,
  ) {}

  async execute(dto: SendAdminSmsDto): Promise<SendAdminSmsResult> {
    return this.repo.sendAdminSms(dto);
  }
}
