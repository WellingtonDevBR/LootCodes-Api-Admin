/**
 * Bamboo checkout requires an AccountId that is active, matches sandbox/live credentials,
 * and (for manual procurement) matches the wallet currency being debited.
 */
import type { BambooAccount } from '../marketplace/bamboo/types.js';

export type ResolveBambooCheckoutAccountResult =
  | { ok: true; accountId: number; resolutionNote?: string }
  | { ok: false; error_message: string };

export function normalizeBambooWalletCurrency(input: string | undefined | null): string {
  const t = (input ?? 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(t)) return 'USD';
  return t;
}

export function parseBambooAccountsResponse(body: unknown): BambooAccount[] {
  if (!body || typeof body !== 'object') return [];
  const o = body as Record<string, unknown>;
  const accountsRaw = o.accounts ?? o.Accounts;
  if (!Array.isArray(accountsRaw)) return [];
  return accountsRaw.map((item): BambooAccount => {
    const a = item as Record<string, unknown>;
    return {
      id: Number(a.id ?? a.Id ?? 0),
      currency: String(a.currency ?? a.Currency ?? ''),
      balance: Number(a.balance ?? a.Balance ?? 0),
      isActive: Boolean(a.isActive ?? a.IsActive ?? false),
      sandboxMode: Boolean(a.sandboxMode ?? a.SandboxMode ?? false),
    };
  });
}

function summarizeLiveWallets(accounts: BambooAccount[]): string {
  if (accounts.length === 0) return 'none';
  return accounts
    .map((a) => `${normalizeBambooWalletCurrency(a.currency)} (${a.id})`)
    .join(', ');
}

export function resolveBambooCheckoutAccountId(
  configuredAccountId: number,
  accounts: BambooAccount[],
  preferredCurrency: string,
): ResolveBambooCheckoutAccountResult {
  const currency = normalizeBambooWalletCurrency(preferredCurrency);
  const list = accounts.filter((a) => Number.isFinite(a.id) && a.id > 0);
  const activeLive = list.filter((a) => a.isActive && !a.sandboxMode);
  const activeLiveInCurrency = activeLive.filter(
    (a) => normalizeBambooWalletCurrency(a.currency) === currency,
  );

  const configured = list.find((a) => a.id === configuredAccountId);
  const configuredCurrency = configured
    ? normalizeBambooWalletCurrency(configured.currency)
    : null;

  if (
    configured?.isActive &&
    !configured.sandboxMode &&
    configuredCurrency === currency
  ) {
    return { ok: true, accountId: configuredAccountId };
  }

  if (configured?.isActive && !configured.sandboxMode && configuredCurrency !== currency) {
    return {
      ok: false,
      error_message:
        `Bamboo api_profile.account_id ${configuredAccountId} is a ${configuredCurrency ?? '?'} wallet; ` +
        `this purchase uses ${currency}. Pick that currency in the UI or set api_profile.account_id to a ${currency} AccountId.`,
    };
  }

  if (configured?.sandboxMode) {
    if (activeLiveInCurrency.length === 1) {
      const w = activeLiveInCurrency[0]!;
      return {
        ok: true,
        accountId: w.id,
        resolutionNote:
          `api_profile.account_id ${configuredAccountId} is a Bamboo sandbox account; ` +
          `using live ${currency} wallet ${w.id}`,
      };
    }
    if (activeLiveInCurrency.length === 0) {
      return {
        ok: false,
        error_message: `No active live Bamboo ${currency} wallet for these credentials. Available live wallets: ${summarizeLiveWallets(activeLive)}.`,
      };
    }
    return {
      ok: false,
      error_message:
        `Multiple live Bamboo ${currency} wallets (${activeLiveInCurrency.map((a) => a.id).join(', ')}). ` +
        `Set api_profile.account_id to the intended ${currency} AccountId.`,
    };
  }

  if (activeLiveInCurrency.length === 1) {
    const w = activeLiveInCurrency[0]!;
    return {
      ok: true,
      accountId: w.id,
      resolutionNote: configuredAccountId
        ? `api_profile.account_id ${configuredAccountId} missing or inactive; using live ${currency} wallet ${w.id}`
        : `using sole live ${currency} Bamboo wallet ${w.id}`,
    };
  }

  if (activeLiveInCurrency.length === 0) {
    return {
      ok: false,
      error_message: `No active live Bamboo ${currency} wallet. Available live wallets: ${summarizeLiveWallets(activeLive)}.`,
    };
  }

  return {
    ok: false,
    error_message:
      `Multiple live Bamboo ${currency} wallets (${activeLiveInCurrency.map((a) => a.id).join(', ')}). ` +
      `Set api_profile.account_id to the correct ${currency} AccountId.`,
  };
}
