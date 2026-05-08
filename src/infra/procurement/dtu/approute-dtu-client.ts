/**
 * AppRoute IDtuClient adapter — wraps `AppRoutePublicApi.postDtuOrder` and
 * `postDtuCheck`.
 */
import type {
  DtuCheckInput,
  DtuCheckResult,
  DtuPlaceOrderInput,
  DtuPlaceOrderResult,
  IDtuClient,
} from '../../../core/ports/dtu-client.port.js';
import type { AppRoutePublicApi } from '../../marketplace/approute/app-route-public-api.js';

export class AppRouteDtuClient implements IDtuClient {
  readonly providerCode = 'approute' as const;

  constructor(private readonly api: AppRoutePublicApi) {}

  async placeOrder(input: DtuPlaceOrderInput): Promise<DtuPlaceOrderResult> {
    const out = await this.api.postDtuOrder({
      referenceId: input.referenceId,
      orders: input.orders.map(serialize),
    });

    return {
      orderId: out.orderId,
      status: out.status,
      ...(typeof out.price === 'number' ? { price: out.price } : {}),
      ...(typeof out.currency === 'string' ? { currency: out.currency } : {}),
      attributes: out.result?.attributes ?? null,
    };
  }

  async check(input: DtuCheckInput): Promise<DtuCheckResult> {
    const out = await this.api.postDtuCheck({
      orders: input.orders.map(serialize),
    });
    return {
      canRecharge: out.canRecharge,
      price: out.price,
      currency: out.currency,
      providerStatus: out.providerStatus,
      ...(out.providerMessage ? { providerMessage: out.providerMessage } : {}),
      ...(out.attributes ? { attributes: out.attributes } : {}),
    };
  }
}

function serialize(line: DtuPlaceOrderInput['orders'][number]) {
  return {
    denominationId: line.denominationId,
    quantity: line.quantity,
    ...(line.amountCurrencyCode ? { amountCurrencyCode: line.amountCurrencyCode } : {}),
    ...(line.fields && line.fields.length > 0 ? { fields: [...line.fields] } : {}),
  };
}
