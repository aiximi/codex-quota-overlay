import type { Language, OverlayState } from '../shared/contracts';
import { button, element, errorMessage, icon } from './dom';
import { dateTime, localDateInput } from './format';
import { translator } from './i18n';

const root = document.getElementById('settings')!;
let current: OverlayState | null = null;
let status = element('p', 'settings-status');
let currentSubscription = element('p', 'current-subscription');
let preferencesBusy = false;
let subscriptionBusy = false;

interface Draft {
  language: string;
  autoStart: boolean;
  refreshSeconds: string;
  cliPath: string;
  subscriptionDate: string;
  willRenew: boolean;
}

function readDraft(): Draft | null {
  const language = document.getElementById('language') as HTMLSelectElement | null;
  if (!language) return null;
  const input = (id: string) => document.getElementById(id) as HTMLInputElement;
  return {
    language: language.value,
    autoStart: input('auto-start').checked,
    refreshSeconds: input('refresh-seconds').value,
    cliPath: input('cli-path').value,
    subscriptionDate: input('subscription-date').value,
    willRenew: input('will-renew').checked,
  };
}

function notify(message: string, isError = false): void {
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

async function perform(action: () => Promise<void>, success?: string): Promise<void> {
  notify('');
  try {
    await action();
    if (success) notify(success);
  } catch (error) {
    notify(
      errorMessage(error, translator(current?.settings.language ?? 'en')('actionFailed')),
      true,
    );
  }
}

function field(labelText: string, id: string, input: HTMLElement, help?: string): HTMLElement {
  const row = element('div', 'field');
  const label = element('label', '', labelText);
  label.htmlFor = id;
  input.id = id;
  row.append(label, input);
  if (help) {
    const description = element('p', 'field-help', help);
    description.id = `${id}-help`;
    input.setAttribute('aria-describedby', description.id);
    row.append(description);
  }
  return row;
}

function checkbox(labelText: string, id: string, checked: boolean, help?: string): HTMLElement {
  const row = element('div', 'checkbox-field');
  const label = element('label', 'checkbox-label');
  const input = element('input');
  input.type = 'checkbox';
  input.id = id;
  input.checked = checked;
  label.append(input, element('span', '', labelText));
  row.append(label);
  if (help) row.append(element('p', 'field-help checkbox-help', help));
  return row;
}

function section(title: string, description?: string): HTMLElement {
  const node = element('section', 'settings-section');
  node.append(element('h2', '', title));
  if (description) node.append(element('p', 'section-description', description));
  return node;
}

function preferencesSection(state: OverlayState, draft: Draft | null): HTMLElement {
  const t = translator(state.settings.language);
  const node = section(t('general'));
  const form = element('form', 'settings-form');
  const language = element('select');
  for (const [value, label] of [
    ['zh-CN', '简体中文'],
    ['en', 'English'],
  ]) {
    const option = element('option', '', label);
    option.value = value;
    language.append(option);
  }
  language.value = draft?.language ?? state.settings.language;
  const refresh = element('input');
  refresh.type = 'number';
  refresh.min = '30';
  refresh.max = '900';
  refresh.step = '1';
  refresh.required = true;
  refresh.value = draft?.refreshSeconds ?? String(state.settings.refreshSeconds);
  const cli = element('input', 'path-input');
  cli.type = 'text';
  cli.autocomplete = 'off';
  cli.spellcheck = false;
  cli.value = draft?.cliPath ?? state.settings.cliPath;
  cli.placeholder = t('cliPlaceholder');
  form.append(
    field(t('language'), 'language', language),
    checkbox(
      t('autoStart'),
      'auto-start',
      draft?.autoStart ?? state.settings.autoStart,
      t('autoStartHelp'),
    ),
    field(
      `${t('refreshInterval')} (${t('seconds')})`,
      'refresh-seconds',
      refresh,
      t('intervalHelp'),
    ),
    field(t('cliPath'), 'cli-path', cli, t('cliHelp')),
  );
  const submit = element('button', 'primary-button', t('save'));
  submit.type = 'submit';
  submit.disabled = preferencesBusy;
  form.append(submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (preferencesBusy) return;
    const values = readDraft()!;
    const interval = Number(values.refreshSeconds);
    if (!Number.isInteger(interval) || interval < 30 || interval > 900) {
      notify(t('invalidInterval'), true);
      refresh.focus();
      return;
    }
    preferencesBusy = true;
    submit.disabled = true;
    submit.textContent = t('saving');
    void perform(() =>
      window.quota.saveSettings({
        language: values.language as Language,
        autoStart: values.autoStart,
        refreshSeconds: interval,
        cliPath: values.cliPath.trim(),
      }),
    )
      .then(() => {
        // The save reply can arrive before onState publishes the new language.
        if (!status.classList.contains('is-error'))
          notify(translator(values.language as Language)('saved'));
      })
      .finally(() => {
        preferencesBusy = false;
        root
          .querySelectorAll<HTMLButtonElement>('.settings-form button[type="submit"]')
          .forEach((node) => {
            node.disabled = false;
            node.textContent = translator(current?.settings.language ?? 'en')('save');
          });
      });
  });
  node.append(form);
  return node;
}

function updateSubscriptionStatus(state: OverlayState): void {
  const t = translator(state.settings.language);
  const subscription = state.subscription;
  currentSubscription.textContent = subscription
    ? `${t('currentDate')}: ${dateTime(subscription.activeUntil, state.settings.language)} · ${t(subscription.source)}`
    : t('dateUnknown');
}

function subscriptionSection(state: OverlayState, draft: Draft | null): HTMLElement {
  const t = translator(state.settings.language);
  const node = section(t('subscription'), t('subscriptionIntro'));
  currentSubscription = element('p', 'current-subscription');
  updateSubscriptionStatus(state);
  const form = element('form', 'subscription-form');
  const date = element('input');
  date.type = 'datetime-local';
  date.required = true;
  date.value = draft?.subscriptionDate ?? localDateInput(state.subscription?.activeUntil ?? null);
  form.append(
    field(t('subscriptionDate'), 'subscription-date', date, t('dateHelp')),
    checkbox(
      t('willRenew'),
      'will-renew',
      draft?.willRenew ?? state.subscription?.willRenew ?? false,
    ),
  );
  const actions = element('div', 'button-row');
  const save = element('button', 'primary-button', t('saveDate'));
  save.type = 'submit';
  save.disabled = subscriptionBusy;
  const clear = button(t('clearDate'), 'secondary-button', () => {
    if (subscriptionBusy) return;
    subscriptionBusy = true;
    toggleBusy(true);
    void perform(() => window.quota.setManualSubscription(null), t('dateCleared')).finally(() => {
      subscriptionBusy = false;
      toggleBusy(false);
    });
  });
  clear.textContent = t('clearDate');
  clear.disabled = subscriptionBusy;
  const toggleBusy = (busy: boolean) => {
    root.querySelectorAll<HTMLButtonElement>('.subscription-form button').forEach((node) => {
      node.disabled = busy;
    });
  };
  actions.append(save, clear);
  form.append(actions);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (subscriptionBusy) return;
    const values = readDraft()!;
    const timestamp = new Date(values.subscriptionDate).getTime();
    if (!values.subscriptionDate || !Number.isFinite(timestamp)) {
      notify(t('invalidDate'), true);
      date.focus();
      return;
    }
    subscriptionBusy = true;
    toggleBusy(true);
    void perform(
      () =>
        window.quota.setManualSubscription({ activeUntil: timestamp, willRenew: values.willRenew }),
      t('dateSaved'),
    ).finally(() => {
      subscriptionBusy = false;
      toggleBusy(false);
    });
  });
  node.append(currentSubscription, form);
  return node;
}

function render(state: OverlayState, preserveDraft = false): void {
  const draft = preserveDraft ? readDraft() : null;
  const t = translator(state.settings.language);
  document.documentElement.lang = state.settings.language;
  document.title = `${t('appName')} · ${t('settings')}`;
  const title = element('header', 'settings-header');
  title.append(element('span', 'eyebrow', `${t('appName')} / ${state.version}`));
  title.append(element('h1', '', t('preferences')), element('p', '', t('settingsIntro')));
  const position = section(t('position'), t('positionHelp'));
  const restore = button(
    t('restorePosition'),
    'secondary-button',
    () => void perform(() => window.quota.resetPosition(), t('restored')),
  );
  restore.textContent = t('restorePosition');
  position.append(restore);
  const footer = element('footer', 'settings-footer');
  const project = button(
    t('github'),
    'text-button',
    () => void perform(() => window.quota.openProject()),
  );
  project.append(element('span', '', t('github')), icon('arrow'));
  const quit = button(
    t('quit'),
    'text-button quit-button',
    () => void perform(() => window.quota.quit()),
  );
  quit.textContent = t('quit');
  footer.append(project, quit);
  const previousMessage = status.textContent;
  const previousError = status.classList.contains('is-error');
  status = element('p', 'settings-status', previousMessage || t('noChanges'));
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.classList.toggle('is-error', previousError);
  root.replaceChildren(
    title,
    preferencesSection(state, draft),
    subscriptionSection(state, draft),
    position,
    status,
    footer,
  );
}

async function start(): Promise<void> {
  let receivedState = false;
  const apply = (state: OverlayState) => {
    const needsRender = !current || current.settings.language !== state.settings.language;
    const hadState = Boolean(current);
    current = state;
    if (needsRender) render(state, hadState);
    else updateSubscriptionStatus(state);
  };
  const unsubscribe = window.quota.onState((state) => {
    receivedState = true;
    apply(state);
  });
  const initial = await window.quota.getState();
  if (!receivedState) apply(initial);
  window.addEventListener('unload', unsubscribe, { once: true });
}

void start().catch(() => {
  root.replaceChildren(element('p', 'startup-error', translator('en')('loadingFailed')));
});
