/**
 * Eneba GraphQL query strings.
 *
 * All queries target the seller-side S_ namespace. Prices come back in EUR cents.
 *
 * NOTE: `auctions` on S_API_Product is DEPRECATED (returns null).
 * NOTE: `isSellable`, `releasedSince` removed — not available on sandbox.
 * Use S_competition for pricing data.
 */
import type { BatchOperation } from './types.js';

export const SEARCH_PRODUCTS_QUERY = `
  query SearchProducts($search: String!, $first: Int, $after: String) {
    S_products(
      search: $search
      first: $first
      after: $after
      onlyUnmapped: false
    ) {
      edges {
        node {
          id
          name
          slug
          regions { code }
          drm { slug }
          type { value }
          createdAt
          releasedAt
          languages
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
      totalCount
    }
  }
`;

// Max 50 competitors per product per Eneba docs. We fetch all 50 so P1/P2
// analysis has the full picture rather than only the first 10.
export const GET_COMPETITION_QUERY = `
  query GetCompetition($productIds: [S_Uuid!]!) {
    S_competition(productIds: $productIds) {
      productId
      competition(first: 50) {
        totalCount
        edges {
          node {
            belongsToYou
            merchantName
            price {
              amount
              currency
            }
          }
        }
      }
    }
  }
`;

export const GET_PRODUCT_QUERY = `
  query GetProduct($productId: S_Uuid!) {
    S_product(productId: $productId) {
      id
      name
      slug
      regions { code }
      drm { slug }
      type { value }
    }
  }
`;

// ─── Stock Query (S_stock) ───────────────────────────────────────────

export const GET_STOCK_QUERY = `
  query GetStock($productId: S_Uuid, $first: Int, $after: String) {
    S_stock(productId: $productId, first: $first, after: $after) {
      edges {
        node {
          id
          product { id name }
          status
          declaredStock
          onHand
          onHold
          unitsSold
          price { amount currency }
          position
          commission {
            rate { amount currency }
            label
          }
          autoRenew
          createdAt
          priceUpdateQuota {
            quota
            nextFreeIn
            totalFree
          }
          competition(first: 10) {
            edges {
              node {
                belongsToYou
                price { amount currency }
              }
            }
          }
        }
      }
      totalCount
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// ─── Price Calculator (S_calculatePrice) ────────────────────────────

export const CALCULATE_PRICE_QUERY = `
  query CalculatePrice($price: S_MoneyInput!, $productId: S_Uuid!) {
    S_calculatePrice(input: { price: $price, productId: $productId }) {
      priceWithCommission { amount currency }
      priceWithoutCommission { amount currency }
      commission {
        rate { amount currency }
        label
      }
    }
  }
`;

// ─── Seller-side Auction Mutations ───────────────────────────────────

/**
 * Build the `S_createAuction` mutation with only the input fields that
 * are actually set. Eneba's sandbox returns an opaque HTTP 500 when the
 * input contains incompatible fields (e.g. `keys: null` together with
 * `declaredStock: 1`); the production resolver tolerates more, but the
 * cleanest contract is to never send fields we don't intend to set.
 */
export interface CreateAuctionShape {
  hasDeclaredStock: boolean;
  hasOnHand: boolean;
  hasKeys: boolean;
  hasPriceIWantToGet: boolean;
}

export function buildCreateAuctionMutation(shape: CreateAuctionShape): string {
  const variableDecls: string[] = [
    '$productId: S_Uuid!',
    '$enabled: Boolean!',
    '$autoRenew: Boolean!',
  ];
  const inputFields: string[] = [
    'productId: $productId',
    'enabled: $enabled',
    'autoRenew: $autoRenew',
  ];

  if (shape.hasPriceIWantToGet) {
    variableDecls.push('$priceIWantToGet: S_MoneyInput!');
    inputFields.push('priceIWantToGet: $priceIWantToGet');
  } else {
    variableDecls.push('$price: S_MoneyInput!');
    inputFields.push('price: $price');
  }

  if (shape.hasDeclaredStock) {
    variableDecls.push('$declaredStock: Int!');
    inputFields.push('declaredStock: $declaredStock');
  }
  if (shape.hasOnHand) {
    variableDecls.push('$onHand: Int!');
    inputFields.push('onHand: $onHand');
  }
  if (shape.hasKeys) {
    variableDecls.push('$keys: [S_KeyInput!]!');
    inputFields.push('keys: $keys');
  }

  return `
    mutation CreateAuction(${variableDecls.join(', ')}) {
      S_createAuction(input: { ${inputFields.join(', ')} }) {
        success
        actionId
        auctionId
      }
    }
  `;
}

/** `declaredStock` is nullable: pass `null` to clear/disable declared stock per Eneba seller docs. */
export const UPDATE_AUCTION_MUTATION = `
  mutation UpdateAuction(
    $auctionId: S_Uuid!
    $price: S_MoneyInput
    $priceIWantToGet: S_MoneyInput
    $declaredStock: Int
    $enabled: Boolean
    $addedKeys: [String!]
    $removedKeys: [S_Uuid!]
    $preventPaidPriceChange: Boolean
  ) {
    S_updateAuction(
      input: {
        id: $auctionId
        price: $price
        priceIWantToGet: $priceIWantToGet
        declaredStock: $declaredStock
        enabled: $enabled
        addedKeys: $addedKeys
        removedKeys: $removedKeys
        preventPaidPriceChange: $preventPaidPriceChange
      }
    ) {
      success
      actionId
      price { amount currency }
      priceChanged
      paidForPriceChange
    }
  }
`;

export const REMOVE_AUCTION_MUTATION = `
  mutation RemoveAuction($auctionId: S_Uuid!) {
    S_removeAuction(input: { id: $auctionId }) {
      actionId
      success
    }
  }
`;

// ─── Declared Stock Setup Mutations ──────────────────────────────────

function escapeGql(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Eneba's P_registerCallback endpoint returns HTTP 500 when GraphQL variables
 * are used. Inline values work. Build the mutation string directly.
 */
export function buildRegisterCallbackMutation(
  type: string,
  url: string,
  authorization: string,
): string {
  return `mutation { P_registerCallback(input: { type: ${type}, url: "${escapeGql(url)}", authorization: "${escapeGql(authorization)}" }) { success } }`;
}

/**
 * P_removeCallback with inline ID — Eneba's API has known issues
 * with GraphQL variables (see buildRegisterCallbackMutation).
 * Using inline values as a precaution.
 */
export function buildRemoveCallbackMutation(callbackId: string): string {
  return `mutation { P_removeCallback(input: { id: "${escapeGql(callbackId)}" }) { success } }`;
}

export const ENABLE_DECLARED_STOCK_MUTATION = `
  mutation EnableDeclaredStock {
    P_enableDeclaredStock {
      success
      failureReason
    }
  }
`;

export const GET_CALLBACKS_QUERY = `
  query GetCallbacks {
    P_apiCallbacks {
      id
      url
      type
      authorization
    }
  }
`;

// ─── Batch Declared Stock / Price Mutations (P_ namespace) ──────────

export const UPDATE_DECLARED_STOCK_MUTATION = `
  mutation UpdateDeclaredStock(
    $statuses: [P_API_AuctionDeclaredStockInput!]!
  ) {
    P_updateDeclaredStock(input: { statuses: $statuses }) {
      success
    }
  }
`;

export const UPDATE_AUCTION_PRICE_MUTATION = `
  mutation UpdateAuctionPrice(
    $items: [P_API_AuctionPriceInput!]!
  ) {
    P_updateAuctionPrice(input: { items: $items }) {
      items {
        auctionId
        price { amount currency }
        priceIWantToGet { amount currency }
        success
        paidForPriceChange
        error
      }
    }
  }
`;

// ─── Global Stock Control ───────────────────────────────────────────

export const UPDATE_STOCK_STATUS_MUTATION = `
  mutation UpdateStockStatus($enabled: Boolean!) {
    P_updateStockStatus(input: { enabled: $enabled }) {
      success
    }
  }
`;

// ─── Key Query (S_keys) ─────────────────────────────────────────────

/**
 * Query keys for a given stock/auction by stockId.
 * Use `state` to filter: ACTIVE (unsold), SOLD, REPORTED.
 * Paginate via `first` + `after` cursor.
 * Either `stockId`, `ids`, `orderNumber`, or `ordersNumbers` is required by Eneba.
 */
export const GET_STOCK_KEYS_QUERY = `
  query GetStockKeys($stockId: S_Uuid, $state: S_KeyState, $ordersNumbers: [String!], $first: Int, $after: String) {
    S_keys(stockId: $stockId, state: $state, ordersNumbers: $ordersNumbers, first: $first, after: $after) {
      edges {
        node {
          id
          value
          state
          reportReason
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// ─── Key Replacement Setup ──────────────────────────────────────────

export const ENABLE_KEY_REPLACEMENTS_MUTATION = `
  mutation EnableDeclaredStockKeyReplacements {
    P_enableDeclaredStockKeyReplacements {
      success
    }
  }
`;

/**
 * Build a single HTTP body that batches N named GraphQL operations.
 *
 * Eneba supports batched requests by sending an array of operation objects
 * in one HTTP POST. Hard limit: 750 operations per batch query, but we
 * cap at 100 for performance (Eneba recommendation).
 */
const MAX_BATCH_SIZE = 100;

export function buildBatchBody(
  operations: BatchOperation[],
): Array<{ operationName: string; query: string; variables: Record<string, unknown> }> {
  if (operations.length > MAX_BATCH_SIZE) {
    throw new Error(
      `Batch size ${operations.length} exceeds maximum of ${MAX_BATCH_SIZE}`,
    );
  }

  return operations.map((op) => ({
    operationName: op.name,
    query: op.query,
    variables: op.variables,
  }));
}
