import type { Language, OverlayState, ResetCredit, UsageWindow } from '../shared/contracts';
import { button, element, errorMessage, icon } from './dom';
import {
  dateTime,
  duration,
  percent,
  remainingPercent,
  validTimestamp,
  windowLabel,
} from './format';
import { translator } from './i18n';
import { isQuotaCurrent, SUBSCRIPTION_REFRESH_MS } from '../shared/freshness';

const root = document.getElementById('overlay')!;
let current: OverlayState | null = null;
let lastStateSignature = '';
let localError: string | null = null;
let localResetPending = false;

async function perform(action: () => Promise<void>): Promise<void> {
  localError = null;
  try {
    await action();
  } catch (error) {
    localError = errorMessage(
      error,
      translator(current?.settings.language ?? 'en')('actionFailed'),
    );
  }
  if (current) render(current);
}

function ring(remaining: number | null): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 28 28');
  svg.setAttribute('class', `quota-ring ${remaining !== null && remaining <= 15 ? 'is-low' : ''}`);
  svg.setAttribute('aria-hidden', 'true');
  for (const foreground of [false, true]) {
    const circle = document.createElementNS(svg.namespaceURI, 'circle');
    circle.setAttribute('cx', '14');
    circle.setAttribute('cy', '14');
    circle.setAttribute('r', '10');
    circle.setAttribute('class', foreground ? 'ring-value' : 'ring-track');
    if (foreground) {
      circle.setAttribute('stroke-dasharray', String(20 * Math.PI));
      circle.setAttribute('stroke-dashoffset', String(20 * Math.PI * (1 - (remaining ?? 0) / 100)));
    }
    svg.append(circle);
  }
  return svg;
}

function heading(title: string, note?: string): HTMLElement {
  const row = element('div', 'section-heading');
  row.append(element('h2', '', title));
  if (note) row.append(element('span', 'caption', note));
  return row;
}

function countdown(
  timestamp: number,
  kind: 'reset' | 'expiry' | 'renewal' | 'date',
  language: Language,
): HTMLElement {
  const node = element('span', 'countdown');
  node.dataset.timestamp = String(timestamp);
  node.dataset.countdown = kind;
  updateCountdown(node, Date.now(), language);
  return node;
}

function updateCountdown(node: HTMLElement, now: number, language: Language): void {
  const t = translator(language);
  const timestamp = Number(node.dataset.timestamp);
  const difference = timestamp - now;
  const isReset = node.dataset.countdown === 'reset';
  const isRenewal = node.dataset.countdown === 'renewal';
  const isDate = node.dataset.countdown === 'date';
  if (!validTimestamp(timestamp)) {
    node.textContent = t('unknown');
    return;
  }
  node.classList.toggle('is-warning', difference < 86400000 && !isReset);
  if (difference <= 0) {
    node.textContent = t(
      isReset ? 'now' : isRenewal ? 'renewalDue' : isDate ? 'dateDue' : 'expired',
    );
  } else if (isReset) {
    node.textContent = `${t('inTime')} ${duration(difference, language)}`;
  } else {
    node.textContent = `${duration(difference, language)} ${t(isRenewal ? 'untilRenewal' : isDate ? 'untilDate' : 'left')}`;
  }
}

function currentQuota(state: OverlayState): boolean {
  return state.preview || (!state.error && isQuotaCurrent(state.snapshot));
}

function header(state: OverlayState): HTMLElement {
  const language = state.settings.language;
  const t = translator(language);
  const node = element('header', 'overlay-header');
  const grip = element('div', 'drag-grip');
  grip.title = t('drag');
  grip.setAttribute('aria-label', t('drag'));
  grip.append(element('span', 'grip-dots', '⠿'));
  const toggle = button(t(state.expanded ? 'collapse' : 'expand'), 'header-toggle', () => {
    void perform(() => window.quota.toggleExpanded());
  });
  toggle.id = 'toggle-expanded';
  toggle.setAttribute('aria-expanded', String(state.expanded));
  toggle.setAttribute('aria-controls', 'quota-details');
  const windows = state.snapshot?.windows ?? [];
  const principal = windows.find((window) => window.windowDurationMins === 10080) ?? windows[0];
  const trusted = currentQuota(state);
  const remaining = trusted && principal ? remainingPercent(principal.usedPercent) : null;
  toggle.append(ring(remaining));
  const summary = element('span', 'header-summary');
  summary.append(
    element(
      'span',
      `header-window ${state.preview || !trusted ? 'is-warning' : ''}`,
      state.preview
        ? t('preview')
        : !trusted
          ? t(state.error ? 'syncFailed' : 'awaitingOfficial')
          : principal
            ? windowLabel(principal, language)
            : t('appName'),
    ),
    element('strong', 'header-percent', percent(remaining)),
  );
  toggle.append(summary, element('span', 'header-divider'));
  const count = trusted ? state.snapshot?.resetCredits?.availableCount : null;
  toggle.append(element('span', 'header-resets', `${count ?? '—'} ${t('resets')}`));
  const status = element(
    'span',
    `connection-dot ${state.loading ? 'is-loading' : ''} ${!trusted ? 'is-error' : ''}`,
  );
  status.title = `${t(state.loading ? 'refreshing' : trusted ? 'officialUpdated' : 'stale')} · ${dateTime(state.snapshot?.capturedAt ?? null, language)}`;
  toggle.append(status, icon('chevron', state.expanded ? 'is-expanded' : ''));
  node.append(grip, toggle);
  return node;
}

function usageCard(window: UsageWindow, language: Language): HTMLElement {
  const t = translator(language);
  const card = element('div', 'usage-card');
  const remaining = remainingPercent(window.usedPercent);
  const row = element('div', 'usage-title');
  row.append(element('span', 'usage-name', windowLabel(window, language)));
  const value = element('div', 'usage-value');
  value.append(
    element('strong', '', percent(remaining)),
    element('span', 'caption', t('remaining')),
  );
  row.append(value);
  const progress = element('progress', remaining !== null && remaining <= 15 ? 'is-low' : '');
  progress.max = 100;
  progress.value = remaining ?? 0;
  progress.setAttribute('aria-label', `${windowLabel(window, language)} ${t('remaining')}`);
  progress.setAttribute('aria-valuetext', percent(remaining));
  card.append(row, progress);
  if (validTimestamp(window.resetsAt)) {
    const next = element('div', 'usage-reset caption');
    const date = element('span', '', `${t('resetsAt')} ${dateTime(window.resetsAt, language)}`);
    next.append(date, countdown(window.resetsAt, 'reset', language));
    card.append(next);
  }
  return card;
}

function resetRow(credit: ResetCredit, index: number, state: OverlayState): HTMLElement {
  const language = state.settings.language;
  const t = translator(language);
  const availability = state.resetAvailability.find((item) => item.id === credit.id);
  const row = element('div', 'reset-row');
  const details = element('div', 'reset-detail');
  const date = validTimestamp(credit.expiresAt)
    ? dateTime(credit.expiresAt, language)
    : t(credit.hasNoExpiration ? 'noExpiration' : 'unknown');
  details.append(element('span', 'reset-name', `${t('credit')} ${index + 1}`));
  details.append(element('strong', 'reset-date', date));
  if (validTimestamp(credit.expiresAt))
    details.append(countdown(credit.expiresAt, 'expiry', language));
  const reset = button(t(availability?.retry ? 'retry' : 'reset'), 'reset-button', () => {
    // A second guard protects against rapid repeated clicks before IPC state arrives.
    if (
      !credit.id ||
      localResetPending ||
      !availability?.enabled ||
      state.preview ||
      state.resetBusy
    )
      return;
    localResetPending = true;
    reset.disabled = true;
    void perform(() => window.quota.requestReset(credit.id!)).finally(() => {
      localResetPending = false;
      if (current) render(current);
    });
  });
  reset.id = `reset-credit-${index}`;
  reset.append(icon('reset'), element('span', '', t(availability?.retry ? 'retry' : 'reset')));
  reset.disabled =
    state.preview || state.resetBusy || localResetPending || !availability?.enabled || !credit.id;
  reset.title = state.preview
    ? t('previewHelp')
    : availability?.reason || (credit.id ? t('resetHelp') : t('noCreditID'));
  reset.setAttribute(
    'aria-label',
    `${t(availability?.retry ? 'retry' : 'reset')} ${t('credit')} ${index + 1}, ${t('resetExpiry')} ${date}`,
  );
  row.append(details, reset);
  return row;
}

function resetSection(state: OverlayState): HTMLElement {
  const t = translator(state.settings.language);
  const section = element('section', 'reset-section');
  const resets = state.snapshot?.resetCredits;
  const visible = (resets?.credits ?? [])
    .filter(
      (credit) =>
        credit.status === 'available' ||
        state.resetAvailability.some((item) => item.id === credit.id && item.retry),
    )
    .sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
  section.append(
    heading(t('resetOpportunities'), `${resets?.availableCount ?? '—'} ${t('available')}`),
  );
  if (!resets || (resets.availableCount > 0 && visible.length === 0)) {
    section.append(element('p', 'empty-note', t('missingResetDetails')));
  } else if (resets.availableCount === 0 && visible.length === 0) {
    section.append(element('p', 'empty-note', t('noResets')));
  } else {
    section.append(element('p', 'section-note', `${t('resetExpiry')} · ${t('resetOrder')}`));
    visible.forEach((credit, index) => section.append(resetRow(credit, index, state)));
    if (resets.availableCount > visible.length) {
      section.append(
        element(
          'p',
          'empty-note',
          `${resets.availableCount - visible.length} · ${t('missingDetails')}`,
        ),
      );
    }
    section.append(element('p', 'section-note reset-help', t('resetHelp')));
  }
  return section;
}

function subscriptionSection(state: OverlayState): HTMLElement {
  const language = state.settings.language;
  const t = translator(language);
  const section = element('section', 'subscription-section');
  const title = heading(t('subscription'));
  const edit = button(
    t('subscriptionHelp'),
    'text-button',
    () => void perform(() => window.quota.openSettings()),
  );
  edit.append(element('span', '', t('settings')), icon('arrow'));
  title.append(edit);
  section.append(title);
  const subscription = state.subscription;
  const manual = state.manualSubscription;
  if (!subscription || !validTimestamp(subscription.activeUntil)) {
    section.append(
      element(
        'p',
        'empty-note',
        t(state.subscriptionLoading ? 'checkingSubscription' : 'dateUnknown'),
      ),
    );
  } else {
    const row = element('div', 'subscription-date-row');
    row.append(
      element(
        'span',
        'caption',
        t(
          subscription.willRenew === null
            ? 'periodEnd'
            : subscription.willRenew
              ? 'renews'
              : 'expires',
        ),
      ),
    );
    row.append(
      element('strong', 'subscription-date', dateTime(subscription.activeUntil, language)),
    );
    const source = element('div', 'subscription-meta');
    const outdated =
      subscription.source === 'official' &&
      Date.now() - subscription.checkedAt > SUBSCRIPTION_REFRESH_MS + 30_000;
    const sourceLabel = element(
      'span',
      'source-pill',
      t(outdated ? 'cached' : subscription.source),
    );
    sourceLabel.dataset.subscriptionSource = subscription.source;
    sourceLabel.dataset.checkedAt = String(subscription.checkedAt);
    source.append(sourceLabel);
    if (subscription.activeUntil <= Date.now())
      source.append(element('span', 'caption is-warning', t('subscriptionExpired')));
    else
      source.append(
        countdown(
          subscription.activeUntil,
          subscription.willRenew === null ? 'date' : subscription.willRenew ? 'renewal' : 'expiry',
          language,
        ),
      );
    section.append(row, source);
    if (subscription.source !== 'manual')
      section.append(
        element(
          'p',
          'section-note',
          `${t('checkedAt')} ${dateTime(subscription.checkedAt, language)}`,
        ),
      );
  }
  if (state.subscriptionError)
    section.append(element('p', 'section-note is-warning', state.subscriptionError));
  if (manual && validTimestamp(manual.activeUntil)) {
    const reference = element('p', 'manual-reference');
    reference.append(
      element('span', 'source-pill', t('manual')),
      element('span', '', dateTime(manual.activeUntil, language)),
    );
    section.append(reference);
  }
  return section;
}

function render(state: OverlayState): void {
  current = state;
  const t = translator(state.settings.language);
  const focusedID = document.activeElement?.id;
  const scrollTop = root.querySelector('.details-scroll')?.scrollTop ?? 0;
  document.documentElement.lang = state.settings.language;
  document.title = t('appName');
  root.classList.toggle('is-expanded', state.expanded);
  root.classList.toggle('quota-not-current', !currentQuota(state));
  root.setAttribute('aria-label', t('appName'));
  root.replaceChildren(header(state));
  if (!state.expanded) return;

  const details = element('div', 'details');
  details.id = 'quota-details';
  const scroll = element('div', 'details-scroll');
  const top = element('div', 'overview-title');
  top.append(element('h1', '', t('quota')));
  if (state.preview) {
    const preview = element('span', 'preview-badge', t('preview'));
    preview.title = t('previewHelp');
    top.append(preview);
  } else if (state.snapshot?.planType)
    top.append(element('span', 'plan-badge', state.snapshot.planType));
  scroll.append(top);
  if (!state.preview && state.snapshot && !currentQuota(state))
    scroll.append(element('p', 'freshness-note', t('notCurrent')));
  if (currentQuota(state) && state.snapshot?.ordinaryUsageAllowed === false)
    scroll.append(element('p', 'freshness-note', t('ordinaryUnavailable')));
  else if (currentQuota(state) && state.snapshot?.spendControlReached === true)
    scroll.append(element('p', 'freshness-note', t('spendControlReached')));
  const windows = state.snapshot?.windows ?? [];
  if (windows.length)
    windows.forEach((window) => scroll.append(usageCard(window, state.settings.language)));
  else {
    const empty = element('div', 'empty-state');
    empty.append(icon('clock'), element('strong', '', t(state.loading ? 'loading' : 'empty')));
    if (!state.loading) empty.append(element('span', 'caption', t('emptyHelp')));
    scroll.append(empty);
  }
  scroll.append(resetSection(state));
  const credits = state.snapshot?.credits;
  const balance = element('section', 'balance-row');
  balance.append(
    element('h2', '', t('balance')),
    element('strong', '', credits?.unlimited ? t('unlimited') : (credits?.balance ?? t('unknown'))),
  );
  scroll.append(balance, subscriptionSection(state));

  const messages = [localError, state.error, state.trackerError].filter((value): value is string =>
    Boolean(value),
  );
  if (messages.length || state.notice || state.resetBusy) {
    const status = element('div', `status-message ${messages.length ? 'has-error' : ''}`);
    status.setAttribute('role', messages.length ? 'alert' : 'status');
    if (state.resetBusy) status.append(element('p', '', t('working')));
    messages.forEach((message) => status.append(element('p', '', message)));
    if (state.notice) status.append(element('p', '', state.notice));
    scroll.append(status);
  }
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  scroll.append(element('p', 'timezone-note', `${t('localTime')} · ${zone}`));
  const footer = element('footer', 'overlay-footer');
  const updated = element('span', 'updated-label');
  const capturedAt = state.snapshot?.capturedAt;
  if (validTimestamp(capturedAt)) updated.dataset.updated = String(capturedAt);
  updated.textContent = state.loading
    ? t('refreshing')
    : validTimestamp(capturedAt)
      ? `${t('officialUpdated')} ${new Intl.DateTimeFormat(state.settings.language, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(capturedAt)}`
      : t('syncing');
  updated.title = validTimestamp(capturedAt)
    ? dateTime(capturedAt, state.settings.language)
    : t('refresh');
  const refresh = button(
    t('refresh'),
    `icon-button ${state.loading ? 'is-loading' : ''}`,
    () => void perform(() => window.quota.refresh()),
  );
  refresh.id = 'refresh-usage';
  refresh.disabled = state.loading || state.resetBusy;
  refresh.append(icon('refresh'));
  const settings = button(
    t('settings'),
    'icon-button',
    () => void perform(() => window.quota.openSettings()),
  );
  settings.id = 'open-settings';
  settings.append(icon('settings'));
  footer.append(updated, refresh, settings);
  details.append(scroll, footer);
  root.append(details);
  scroll.scrollTop = scrollTop;
  if (focusedID) document.getElementById(focusedID)?.focus({ preventScroll: true });
}

async function start(): Promise<void> {
  let receivedState = false;
  const applyState = (state: OverlayState) => {
    // Native window tracking may publish unchanged state several times per second.
    // Keep existing button nodes in place so a mouse press cannot lose its target.
    const signature = JSON.stringify(state);
    if (signature === lastStateSignature) return;
    lastStateSignature = signature;
    render(state);
  };
  const unsubscribe = window.quota.onState((state) => {
    receivedState = true;
    applyState(state);
  });
  const initial = await window.quota.getState();
  if (!receivedState) applyState(initial);
  const ticker = window.setInterval(() => {
    if (!current) return;
    const stale = !currentQuota(current);
    if (root.classList.contains('quota-not-current') !== stale) render(current);
    root.querySelectorAll<HTMLElement>('[data-subscription-source]').forEach((node) => {
      const source = node.dataset.subscriptionSource as 'official' | 'cached' | 'manual';
      const old =
        source === 'official' &&
        Date.now() - Number(node.dataset.checkedAt) > SUBSCRIPTION_REFRESH_MS + 30_000;
      node.textContent = translator(current!.settings.language)(old ? 'cached' : source);
    });
    root
      .querySelectorAll<HTMLElement>('[data-countdown]')
      .forEach((node) => updateCountdown(node, Date.now(), current!.settings.language));
  }, 1000);
  window.addEventListener(
    'unload',
    () => {
      clearInterval(ticker);
      unsubscribe();
    },
    { once: true },
  );
}

void start().catch(() => {
  root.replaceChildren(element('p', 'startup-error', translator('en')('loadingFailed')));
});
