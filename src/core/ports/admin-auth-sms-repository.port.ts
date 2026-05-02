import type {
  SendAdminSmsDto,
  SendAdminSmsResult,
  VerifyAdminSmsDto,
  VerifyAdminSmsResult,
  SendSecurityAlertSmsDto,
  SendSecurityAlertSmsResult,
} from '../use-cases/admin-auth/admin-auth.types.js';

export interface IAdminAuthSmsRepository {
  sendAdminSms(dto: SendAdminSmsDto): Promise<SendAdminSmsResult>;
  verifyAdminSms(dto: VerifyAdminSmsDto): Promise<VerifyAdminSmsResult>;
  sendSecurityAlertSms(dto: SendSecurityAlertSmsDto): Promise<SendSecurityAlertSmsResult>;
}
