import type {
  ListAlertsDto,
  ListAlertsResult,
  DismissAlertDto,
  DismissAllAlertsDto,
  DismissAllByFilterDto,
} from '../use-cases/alerts/alerts.types.js';

export interface IAdminAlertsRepository {
  listAlerts(dto: ListAlertsDto): Promise<ListAlertsResult>;
  dismissAlert(dto: DismissAlertDto): Promise<void>;
  dismissAllAlerts(dto: DismissAllAlertsDto): Promise<void>;
  dismissAllByFilter(dto: DismissAllByFilterDto): Promise<number>;
}
