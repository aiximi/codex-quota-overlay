/** All timestamps crossing the process boundary are milliseconds since Unix epoch. */
export interface UsageWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface ResetCredit {
  id: string | null;
  status: string;
  resetType: string;
  expiresAt: number | null;
  hasNoExpiration: boolean;
  title: string | null;
}

export interface QuotaSnapshot {
  capturedAt: number;
  windows: UsageWindow[];
  planType: string | null;
  credits: { balance: string | null; unlimited: boolean; hasCredits: boolean } | null;
  resetCredits: { availableCount: number; credits: ResetCredit[] | null } | null;
}

export interface SubscriptionInfo {
  activeUntil: number;
  willRenew: boolean | null;
  checkedAt: number;
  source: 'official' | 'cached' | 'manual';
}

export type ResetOutcome = 'reset' | 'alreadyRedeemed' | 'nothingToReset' | 'noCredit';
export type Language = 'zh-CN' | 'en';

export interface AppSettings {
  language: Language;
  autoStart: boolean;
  refreshSeconds: number;
  offset: { x: number; y: number };
  cliPath: string;
}

export interface ResetAvailability {
  id: string;
  enabled: boolean;
  retry: boolean;
  reason: string | null;
}

export interface OverlayState {
  version: string;
  expanded: boolean;
  preview: boolean;
  snapshot: QuotaSnapshot | null;
  subscription: SubscriptionInfo | null;
  loading: boolean;
  resetBusy: boolean;
  error: string | null;
  notice: string | null;
  trackerError: string | null;
  resetAvailability: ResetAvailability[];
  settings: AppSettings;
}

export type SettingsPatch = Partial<
  Pick<AppSettings, 'language' | 'autoStart' | 'refreshSeconds' | 'cliPath'>
>;

/** Explicit IPC surface: never exposes files, tokens, shell execution or raw IPC. */
export interface OverlayBridge {
  getState(): Promise<OverlayState>;
  onState(listener: (state: OverlayState) => void): () => void;
  refresh(): Promise<void>;
  toggleExpanded(): Promise<void>;
  requestReset(creditID: string): Promise<void>;
  openSettings(): Promise<void>;
  saveSettings(patch: SettingsPatch): Promise<void>;
  setManualSubscription(value: { activeUntil: number; willRenew: boolean } | null): Promise<void>;
  resetPosition(): Promise<void>;
  openProject(): Promise<void>;
  quit(): Promise<void>;
}

declare global {
  interface Window {
    quota: OverlayBridge;
  }
}
