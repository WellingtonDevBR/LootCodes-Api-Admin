import type {
  RequestActionDto,
  RequestActionResult,
  ApproveActionDto,
  ApproveActionResult,
  RejectActionDto,
  RejectActionResult,
  ListActionRequestsDto,
  ListActionRequestsResult,
} from '../use-cases/approvals/approval.types.js';

export interface IAdminApprovalRepository {
  requestAction(dto: RequestActionDto): Promise<RequestActionResult>;
  approveAction(dto: ApproveActionDto): Promise<ApproveActionResult>;
  rejectAction(dto: RejectActionDto): Promise<RejectActionResult>;
  listActionRequests(dto: ListActionRequestsDto): Promise<ListActionRequestsResult>;
}
