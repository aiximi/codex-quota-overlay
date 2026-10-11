import { createHash, randomUUID } from 'node:crypto';
import type { QuotaSnapshot, ResetCredit, ResetOutcome } from '../shared/contracts.js';
import { isRecord, validOpaqueValue } from './auth.js';
import type { ConsumeResetRequest } from './rpc.js';
import type { Store } from './storage.js';

interface PendingReset {
  creditID: string;
  idempotencyKey: string;
}
export interface Availability {
  enabled: boolean;
  retry: boolean;
  reason: string | null;
}

/** Only an explicit confirmed call can submit a reset. Errors retain the same UUID. */
export class ResetManager {
  private processing = false;

  constructor(
    private readonly store: Store,
    private readonly currentAccountKey: () => Promise<string | null>,
    private readonly consume: (request: ConsumeResetRequest) => Promise<ResetOutcome>,
  ) {}

  get busy(): boolean {
    return this.processing;
  }

  availability(credit: ResetCredit, accountKey: string): Availability {
    const pending = this.store.get<unknown>(this.pendingKey(accountKey));
    const retry = isRecord(pending) && pending.creditID === credit.id;
    let reason: string | null = null;
    if (!validOpaqueValue(accountKey)) reason = 'Sign in and refresh before resetting.';
    else if (this.processing) reason = 'A reset is already in progress.';
    else if (
      !validOpaqueValue(credit.id) ||
      credit.status !== 'available' ||
      credit.resetType !== 'codexRateLimits' ||
      !(credit.hasNoExpiration || (credit.expiresAt !== null && credit.expiresAt > Date.now()))
    ) {
      reason = 'This reset is unavailable. Refresh to check its status.';
    } else if (this.store.get(this.completedKey(accountKey, credit.id))) {
      reason = 'This reset has already been processed. Refresh to see the current quota.';
    } else if (
      pending !== undefined &&
      (!isRecord(pending) ||
        !validOpaqueValue(pending.creditID) ||
        !this.validUUID(pending.idempotencyKey))
    ) {
      reason = 'The saved reset receipt is invalid. Restore the settings file before continuing.';
    } else if (pending !== undefined && !retry) {
      reason = 'A previous reset is unresolved. Refresh or retry the same reset first.';
    }
    return { enabled: reason === null, retry, reason };
  }

  async execute(
    credit: ResetCredit,
    accountKey: string,
    confirmed: boolean,
  ): Promise<ResetOutcome | undefined> {
    if (!confirmed) return undefined;
    const availability = this.availability(credit, accountKey);
    if (!availability.enabled) throw new Error(availability.reason!);
    this.processing = true;
    try {
      if ((await this.currentAccountKey()) !== accountKey) {
        throw new Error('The signed-in account changed. Refresh before resetting.');
      }
      const creditID = credit.id!;
      const pendingKey = this.pendingKey(accountKey);
      const previous = this.store.get<PendingReset>(pendingKey);
      const pending = previous ?? { creditID, idempotencyKey: randomUUID() };
      if (!previous) this.store.set(pendingKey, pending);
      const outcome = await this.consume({
        creditID,
        idempotencyKey: pending.idempotencyKey,
        expectedAccountKey: accountKey,
        currentAccountKey: this.currentAccountKey,
      });
      if (outcome === 'reset' || outcome === 'alreadyRedeemed') {
        // Receipt is durably written before pending state is cleared.
        this.store.set(this.completedKey(accountKey, creditID), true);
      }
      this.store.delete(pendingKey);
      return outcome;
    } finally {
      this.processing = false;
    }
  }

  async reconcile(snapshot: QuotaSnapshot, accountKey: string): Promise<void> {
    if (this.processing || (await this.currentAccountKey()) !== accountKey || this.processing)
      return;
    const pending = this.store.get<PendingReset>(this.pendingKey(accountKey));
    const resets = snapshot.resetCredits;
    const rows = resets?.credits;
    if (!pending || !isRecord(pending) || !validOpaqueValue(pending.creditID) || !resets || !rows)
      return;
    // A row that is redeeming/unknown must keep its in-flight receipt, even when count=0.
    if (rows.some((row) => row.id === pending.creditID && row.status !== 'redeemed')) return;
    const available = rows.filter((row) => row.status === 'available');
    const ids = available.map((row) => row.id).filter(validOpaqueValue);
    // Partial/missing lists cannot prove that the selected credit is no longer available.
    if (ids.length !== available.length || new Set(ids).size < resets.availableCount) return;
    this.store.set(this.completedKey(accountKey, pending.creditID), true);
    this.store.delete(this.pendingKey(accountKey));
  }

  private pendingKey(account: string): string {
    return `reset.pending.${account}`;
  }

  private completedKey(account: string, credit: string): string {
    return `reset.completed.${account}.${createHash('sha256').update(credit).digest('hex')}`;
  }

  private validUUID(value: unknown): value is string {
    return (
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    );
  }
}
