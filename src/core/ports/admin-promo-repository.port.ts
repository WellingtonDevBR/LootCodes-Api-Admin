import type {
  CreatePromoCodeDto,
  CreatePromoCodeResult,
  UpdatePromoCodeDto,
  UpdatePromoCodeResult,
  TogglePromoActiveDto,
  TogglePromoActiveResult,
  DeletePromoCodeDto,
  DeletePromoCodeResult,
  SubmitPromoApprovalDto,
  SubmitPromoApprovalResult,
  ApprovePromoCodeDto,
  ApprovePromoCodeResult,
  RejectPromoCodeDto,
  RejectPromoCodeResult,
  SendPromoNotificationsDto,
  SendPromoNotificationsResult,
  EstimatePromoReachDto,
  EstimatePromoReachResult,
  ListPromoCodesDto,
  ListPromoCodesResult,
  GetPromoUsageStatsDto,
  GetPromoUsageStatsResult,
} from '../use-cases/promo/promo.types.js';

export interface IAdminPromoRepository {
  createPromoCode(dto: CreatePromoCodeDto): Promise<CreatePromoCodeResult>;
  updatePromoCode(dto: UpdatePromoCodeDto): Promise<UpdatePromoCodeResult>;
  togglePromoActive(dto: TogglePromoActiveDto): Promise<TogglePromoActiveResult>;
  deletePromoCode(dto: DeletePromoCodeDto): Promise<DeletePromoCodeResult>;
  submitPromoApproval(dto: SubmitPromoApprovalDto): Promise<SubmitPromoApprovalResult>;
  approvePromoCode(dto: ApprovePromoCodeDto): Promise<ApprovePromoCodeResult>;
  rejectPromoCode(dto: RejectPromoCodeDto): Promise<RejectPromoCodeResult>;
  sendPromoNotifications(dto: SendPromoNotificationsDto): Promise<SendPromoNotificationsResult>;
  estimatePromoReach(dto: EstimatePromoReachDto): Promise<EstimatePromoReachResult>;
  listPromoCodes(dto: ListPromoCodesDto): Promise<ListPromoCodesResult>;
  getPromoUsageStats(dto: GetPromoUsageStatsDto): Promise<GetPromoUsageStatsResult>;
}
