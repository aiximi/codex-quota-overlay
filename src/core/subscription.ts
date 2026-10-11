import type { SubscriptionInfo } from '../shared/contracts.js';
import { type Credentials, isRecord, validateCredentials } from './auth.js';

export type SubscriptionFetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function parseSubscription(
  value: unknown,
  expectedAccountID: string,
  now = Date.now(),
): SubscriptionInfo {
  if (
    !isRecord(value) ||
    (value.account_id !== undefined && value.account_id !== expectedAccountID) ||
    typeof value.active_until !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value.active_until,
    )
  ) {
    throw new Error('The subscription service did not return a confirmed expiration date.');
  }
  const activeUntil = Date.parse(value.active_until);
  if (!Number.isFinite(activeUntil) || activeUntil <= 0) {
    throw new Error('The subscription service did not return a confirmed expiration date.');
  }
  return {
    activeUntil,
    willRenew: typeof value.will_renew === 'boolean' ? value.will_renew : null,
    checkedAt: now,
    source: 'official',
  };
}

/** This token can only be sent to one fixed official endpoint, with redirects disabled. */
export async function readSubscription(
  credentials: Credentials,
  fetcher: SubscriptionFetcher = globalThis.fetch,
): Promise<SubscriptionInfo> {
  validateCredentials(credentials);
  const url = new URL('https://chatgpt.com/backend-api/subscriptions');
  url.searchParams.set('account_id', credentials.accountID);
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        'ChatGPT-Account-ID': credentials.accountID,
        Accept: 'application/json',
      },
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new Error('The subscription service could not be reached.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('Sign in to Codex with a ChatGPT account.');
  }
  if (response.status !== 200) throw new Error('The subscription date is unavailable.');
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1_000_000) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(value);
    }
    return parseSubscription(
      JSON.parse(Buffer.concat(chunks).toString('utf8')),
      credentials.accountID,
    );
  } catch {
    throw new Error('The subscription service did not return a confirmed expiration date.');
  }
}
