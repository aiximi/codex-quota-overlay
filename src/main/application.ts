import { dialog, net } from 'electron';
import { getAccountKey, readCredentials, type Credentials } from '../core/auth';
import { CodexClient } from '../core/rpc';
import { ResetManager } from '../core/reset';
import { Store } from '../core/storage';
import { readSubscription } from '../core/subscription';
import type {
  AppSettings,
  OverlayState,
  SettingsPatch,
  SubscriptionInfo,
} from '../shared/contracts';
import { discoverCLI } from './platform/discovery';
import { DEFAULT_SETTINGS, validateSettings } from './settings';
import { previewData } from './fixtures';
import { isQuotaCurrent, shouldRefreshQuota, SUBSCRIPTION_REFRESH_MS } from '../shared/freshness';

export class QuotaApplication {
  readonly state: OverlayState;
  private account: string | null = null;
  private client: CodexClient | null = null;
  private executable = '';
  private lastRead = 0;
  private lastSubscription = 0;
  private lastIdentityCheck = 0;
  private accountGeneration = 0;
  private subscriptionRequest = 0;
  private wasVisible = false;
  private foregroundRefreshPending = false;
  private resetManager: ResetManager;
  private stopped = false;
  appPath: string | undefined;

  constructor(
    private readonly store: Store,
    version: string,
    preview: boolean,
    private readonly readOnly: boolean,
    private readonly changed: () => void,
  ) {
    const saved = store.get<Partial<AppSettings>>('settings') ?? {};
    let settings = { ...DEFAULT_SETTINGS };
    try {
      const { offset, ...patch } = saved;
      settings = { ...settings, ...validateSettings(patch) };
      // Migrate the old default; keep deliberately different saved intervals.
      if (!store.get<boolean>('syncSettingsV2') && settings.refreshSeconds === 60)
        settings.refreshSeconds = DEFAULT_SETTINGS.refreshSeconds;
      if (offset && Number.isFinite(offset.x) && Number.isFinite(offset.y))
        settings.offset = offset;
    } catch {
      /* Fall back to safe preferences; never discard reset receipts. */
    }
    this.state = {
      version,
      expanded: false,
      preview,
      snapshot: null,
      subscription: null,
      manualSubscription: null,
      subscriptionLoading: false,
      subscriptionError: null,
      loading: false,
      resetBusy: false,
      error: null,
      notice: null,
      trackerError: null,
      resetAvailability: [],
      settings,
    };
    this.resetManager = new ResetManager(
      store,
      () => getAccountKey(),
      async (request) => {
        if (this.readOnly || this.state.preview || !this.client)
          throw new Error('Reset is disabled.');
        return this.client.consumeReset(request);
      },
    );
    if (preview) Object.assign(this.state, previewData());
  }

  text(zh: string, en: string): string {
    return this.state.settings.language === 'zh-CN' ? zh : en;
  }

  publish(): void {
    const credits = this.state.snapshot?.resetCredits?.credits ?? [];
    this.state.resetAvailability = credits.flatMap((credit) => {
      if (!credit.id) return [];
      const available = this.resetManager.availability(credit, this.account ?? '');
      const stale = !isQuotaCurrent(this.state.snapshot);
      const blocked =
        this.state.preview ||
        this.readOnly ||
        this.state.loading ||
        this.state.resetBusy ||
        !!this.state.error ||
        stale ||
        !this.state.snapshot?.resetCredits?.availableCount;
      return [
        {
          id: credit.id,
          ...available,
          enabled: available.enabled && !blocked,
          reason: blocked
            ? this.text(
                '请先同步当前账户；预览模式不能重置。',
                'Refresh the current account. Reset is disabled in preview.',
              )
            : available.reason,
        },
      ];
    });
    if (!this.stopped) this.changed();
  }

  private selectAccount(account: string | null): void {
    if (account === this.account) return;
    this.account = account;
    this.accountGeneration += 1;
    this.subscriptionRequest += 1;
    this.state.snapshot = null;
    this.state.subscription = null;
    this.state.manualSubscription = null;
    this.state.subscriptionLoading = false;
    this.state.subscriptionError = null;
    this.state.notice = null;
    this.lastRead = 0;
    this.lastSubscription = 0;
    if (account) {
      const cached = this.store.get<SubscriptionInfo>(`subscription.cached.${account}`);
      this.state.subscription = cached ? { ...cached, source: 'cached' } : null;
      this.state.manualSubscription =
        this.store.get<SubscriptionInfo>(`subscription.manual.${account}`) ?? null;
    }
    this.publish();
  }

  resume(): void {
    this.foregroundRefreshPending = true;
    this.lastIdentityCheck = 0;
  }

  async tick(visible: boolean): Promise<void> {
    if (this.stopped || this.state.preview) return;
    if (visible && !this.wasVisible) this.foregroundRefreshPending = true;
    this.wasVisible = visible;
    // Keep checking identity even while a slow request is in flight.
    if (visible && Date.now() - this.lastIdentityCheck > 2_000) {
      this.lastIdentityCheck = Date.now();
      const account = await getAccountKey();
      if (this.stopped) return;
      this.selectAccount(account);
    }
    if (
      !isQuotaCurrent(this.state.snapshot) &&
      this.state.resetAvailability.some((credit) => credit.enabled)
    )
      this.publish();
    if (this.state.loading || this.state.resetBusy) return;
    if (
      visible &&
      shouldRefreshQuota(
        this.state.snapshot,
        this.lastRead,
        this.state.settings.refreshSeconds,
        this.foregroundRefreshPending,
        Date.now(),
      )
    ) {
      this.foregroundRefreshPending = false;
      await this.refresh();
    }
  }

  private async refreshSubscription(credentials: Credentials, force: boolean): Promise<void> {
    if (
      this.stopped ||
      credentials.accountKey !== this.account ||
      this.state.subscriptionLoading ||
      (!force && Date.now() - this.lastSubscription < SUBSCRIPTION_REFRESH_MS)
    )
      return;
    const generation = this.accountGeneration;
    const request = ++this.subscriptionRequest;
    this.lastSubscription = Date.now();
    this.state.subscriptionLoading = true;
    this.publish();
    try {
      const result = await readSubscription(credentials, (input, init) =>
        net.fetch(input instanceof URL ? input.toString() : input, init),
      );
      if (
        this.stopped ||
        request !== this.subscriptionRequest ||
        generation !== this.accountGeneration
      )
        return;
      const current = await getAccountKey();
      if (
        this.stopped ||
        request !== this.subscriptionRequest ||
        generation !== this.accountGeneration
      )
        return;
      if (current !== credentials.accountKey) {
        this.selectAccount(current);
        return;
      }
      this.store.set(`subscription.cached.${credentials.accountKey}`, result);
      this.state.subscription = result;
      this.state.subscriptionError = null;
    } catch {
      if (
        this.stopped ||
        request !== this.subscriptionRequest ||
        generation !== this.accountGeneration
      )
        return;
      if (this.state.subscription?.source === 'official')
        this.state.subscription = { ...this.state.subscription, source: 'cached' };
      this.state.subscriptionError = this.text(
        '官方订阅日期暂未核实。',
        'The official subscription date could not be verified.',
      );
    } finally {
      if (
        !this.stopped &&
        request === this.subscriptionRequest &&
        generation === this.accountGeneration
      ) {
        this.state.subscriptionLoading = false;
        this.publish();
      }
    }
  }

  async refresh(forceSubscription = false): Promise<void> {
    if (this.stopped || this.state.loading || this.state.resetBusy) return;
    if (this.state.preview) {
      Object.assign(this.state, previewData());
      this.publish();
      return;
    }
    this.state.loading = true;
    this.lastRead = Date.now();
    this.publish();
    try {
      const credentials = await readCredentials();
      if (this.stopped) return;
      this.selectAccount(credentials.accountKey);
      const generation = this.accountGeneration;
      this.lastRead = Date.now();
      void this.refreshSubscription(credentials, forceSubscription);
      const executable = await discoverCLI(this.state.settings.cliPath || undefined, this.appPath);
      if (this.stopped) return;
      if (!executable)
        throw new Error(
          this.text(
            '未找到 Codex CLI，请在设置中选择其原生可执行文件。',
            'Codex CLI was not found. Select its native executable in Settings.',
          ),
        );
      if (executable !== this.executable) {
        this.client?.close();
        this.client = new CodexClient(executable);
        this.executable = executable;
      }
      const snapshot = await this.client!.readLimits(credentials.accountID);
      if (this.stopped) return;
      const currentAccount = await getAccountKey();
      if (this.stopped) return;
      if (currentAccount !== credentials.accountKey || generation !== this.accountGeneration)
        throw new Error(
          this.text('账户已切换，请重新同步。', 'The account changed. Refresh again.'),
        );
      this.state.snapshot = snapshot;
      this.state.error = null;
      await this.resetManager.reconcile(snapshot, credentials.accountKey);
      if (this.stopped) return;
      // Quota is independent of optional subscription billing information.
      this.publish();
    } catch (error) {
      if (this.stopped) return;
      const current = await getAccountKey();
      if (this.stopped) return;
      this.selectAccount(current);
      this.state.error =
        error instanceof Error
          ? error.message
          : this.text('同步失败，请稍后重试。', 'Refresh failed. Try again later.');
    } finally {
      this.state.loading = false;
      this.publish();
    }
  }

  async requestReset(creditID: unknown): Promise<void> {
    if (
      this.stopped ||
      this.state.preview ||
      this.readOnly ||
      this.state.resetBusy ||
      this.state.loading ||
      typeof creditID !== 'string'
    )
      return;
    // Derive permissions at the click boundary, even when the refresh interval is long.
    this.publish();
    const account = this.account;
    const credit = this.state.snapshot?.resetCredits?.credits?.find((row) => row.id === creditID);
    const permission = this.state.resetAvailability.find((row) => row.id === creditID);
    if (!account || !credit || !permission?.enabled || (await getAccountKey()) !== account) {
      this.state.notice = this.text(
        '请先刷新，重新选择可用重置机会。',
        'Refresh and select an available reset.',
      );
      this.publish();
      return;
    }
    // Recheck after the await: a second click may have arrived while identity was read.
    if (
      this.stopped ||
      this.state.resetBusy ||
      this.state.loading ||
      !this.state.snapshot ||
      !isQuotaCurrent(this.state.snapshot)
    )
      return;
    this.state.resetBusy = true;
    this.publish();
    try {
      const expiry = credit.expiresAt
        ? new Date(credit.expiresAt).toLocaleString(this.state.settings.language)
        : this.text('无到期限制', 'No expiration');
      const answer = await dialog.showMessageBox({
        type: 'warning',
        title: 'Codex Quota Overlay',
        message: this.text('确认使用 1 次重置机会？', 'Use one reset credit?'),
        detail:
          this.text(
            `到期时间：${expiry}\n将使用所选机会重置符合条件的额度。成功后会消耗 1 次，无法撤销。`,
            `Expires: ${expiry}\nThis uses the selected credit to reset eligible quota windows. A successful reset consumes one credit and cannot be undone.`,
          ) +
          (permission.retry
            ? this.text(
                '\n继续确认同一次操作，不会改用另一条机会。',
                '\nThis retries the same operation and never selects another credit.',
              )
            : ''),
        buttons: [this.text('取消', 'Cancel'), this.text('确认消耗 1 次', 'Confirm reset')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (answer.response !== 1 || this.stopped) return;
      if (!this.state.snapshot || !isQuotaCurrent(this.state.snapshot)) {
        this.state.notice = this.text(
          '额度数据已过期，请刷新后重新确认。',
          'Quota data has expired. Refresh and confirm again.',
        );
        return;
      }
      const outcome = await this.resetManager.execute(credit, account, true);
      const messages = {
        reset: ['重置成功，已使用 1 次机会。', 'Reset complete. One credit was used.'],
        alreadyRedeemed: [
          '这次重置已处理，正在同步额度。',
          'This reset was already completed. Refreshing quota.',
        ],
        nothingToReset: [
          '没有符合条件的额度需要重置，未消耗机会。',
          'No eligible quota needs resetting. No credit was used.',
        ],
        noCredit: [
          '这次机会已不可用，请查看最新明细。',
          'This credit is no longer available. Check refreshed details.',
        ],
      };
      if (outcome) this.state.notice = this.text(messages[outcome][0], messages[outcome][1]);
    } catch {
      this.state.notice = this.text(
        '结果尚未确认。请刷新核对；重试原条目会沿用同一次操作。',
        'The result is unconfirmed. Refresh first; retrying the same credit reuses the same operation.',
      );
    } finally {
      this.state.resetBusy = false;
      this.publish();
    }
    await this.refresh();
  }

  saveSettings(input: unknown): SettingsPatch {
    if (this.state.resetBusy || this.state.loading)
      throw new Error(
        this.text('同步或重置中，请稍候。', 'Please wait for the current operation.'),
      );
    const patch = validateSettings(input);
    this.state.settings = { ...this.state.settings, ...patch };
    this.store.set('settings', this.state.settings);
    this.store.set('syncSettingsV2', true);
    this.publish();
    return patch;
  }

  saveOffset(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const settings = { ...this.state.settings, offset: { x, y } };
    try {
      this.store.set('settings', settings);
      this.state.settings = settings;
    } catch {
      this.state.notice = this.text(
        '位置未能保存，请检查磁盘空间和文件权限。',
        'The position could not be saved. Check disk space and file permissions.',
      );
      this.publish();
    }
  }

  async setManualSubscription(value: unknown): Promise<void> {
    if (this.state.preview)
      throw new Error(
        this.text('预览模式不保存账号日期。', 'Preview does not save account dates.'),
      );
    const account = await getAccountKey();
    if (!account || account !== this.account)
      throw new Error(this.text('请先同步当前账户。', 'Refresh the current account first.'));
    const key = `subscription.manual.${account}`;
    if (value === null) {
      this.store.delete(key);
      this.lastSubscription = 0;
      this.state.manualSubscription = null;
    } else {
      const candidate = value as Record<string, unknown>;
      if (
        !candidate ||
        typeof candidate.activeUntil !== 'number' ||
        !Number.isFinite(candidate.activeUntil) ||
        candidate.activeUntil < 0 ||
        candidate.activeUntil > 8_000_000_000_000 ||
        typeof candidate.willRenew !== 'boolean'
      )
        throw new Error('Invalid subscription date');
      const entry: SubscriptionInfo = {
        activeUntil: candidate.activeUntil,
        willRenew: candidate.willRenew,
        checkedAt: Date.now(),
        source: 'manual',
      };
      this.store.set(key, entry);
      this.state.manualSubscription = entry;
    }
    this.publish();
  }

  close(): void {
    this.stopped = true;
    this.subscriptionRequest += 1;
    this.client?.close();
  }
}
