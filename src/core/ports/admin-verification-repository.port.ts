import type {
  ApproveVerificationDto,
  ApproveVerificationResult,
  DenyVerificationDto,
  DenyVerificationResult,
} from '../use-cases/verification/verification.types.js';

export interface IAdminVerificationRepository {
  approveVerification(dto: ApproveVerificationDto): Promise<ApproveVerificationResult>;
  denyVerification(dto: DenyVerificationDto): Promise<DenyVerificationResult>;
}
