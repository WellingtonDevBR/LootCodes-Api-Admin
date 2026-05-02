import type {
  FulfillVerifiedOrderDto,
  FulfillVerifiedOrderResult,
  ManualFulfillDto,
  ManualFulfillResult,
  RecoverOrderDto,
  RecoverOrderResult,
  ConfirmPaymentDto,
  ConfirmPaymentResult,
  ProcessPreorderDto,
  ProcessPreorderResult,
  GenerateGuestAccessLinkDto,
  GenerateGuestAccessLinkResult,
  RefundOrderDto,
  RefundOrderResult,
  RefundTicketDto,
  RefundTicketResult,
  RefundInitiateDto,
  RefundInitiateResult,
  ReissueEmailDto,
  ReissueEmailResult,
  ListOrdersDto,
  ListOrdersResult,
} from '../use-cases/orders/order.types.js';

export interface IAdminOrderRepository {
  fulfillVerifiedOrder(dto: FulfillVerifiedOrderDto): Promise<FulfillVerifiedOrderResult>;
  manualFulfill(dto: ManualFulfillDto): Promise<ManualFulfillResult>;
  recoverOrder(dto: RecoverOrderDto): Promise<RecoverOrderResult>;
  confirmPayment(dto: ConfirmPaymentDto): Promise<ConfirmPaymentResult>;
  processPreorder(dto: ProcessPreorderDto): Promise<ProcessPreorderResult>;
  generateGuestAccessLink(dto: GenerateGuestAccessLinkDto): Promise<GenerateGuestAccessLinkResult>;
  refundOrder(dto: RefundOrderDto): Promise<RefundOrderResult>;
  refundTicket(dto: RefundTicketDto): Promise<RefundTicketResult>;
  refundInitiate(dto: RefundInitiateDto): Promise<RefundInitiateResult>;
  reissueEmail(dto: ReissueEmailDto): Promise<ReissueEmailResult>;
  listOrders(dto: ListOrdersDto): Promise<ListOrdersResult>;
  getOrderDetail(orderId: string): Promise<unknown>;
}
