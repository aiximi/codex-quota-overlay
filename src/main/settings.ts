import type { AppSettings, SettingsPatch } from '../shared/contracts';

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'zh-CN',
  autoStart: false,
  refreshSeconds: 60,
  offset: { x: 16, y: 64 },
  cliPath: '',
};

export function validateSettings(value: unknown): SettingsPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid settings');
  const patch = value as Record<string, unknown>;
  const allowed = ['language', 'autoStart', 'refreshSeconds', 'cliPath'];
  if (Object.keys(patch).some((key) => !allowed.includes(key))) throw new Error('Unknown setting');
  if ('language' in patch && !['zh-CN', 'en'].includes(String(patch.language)))
    throw new Error('Unsupported language');
  if ('autoStart' in patch && typeof patch.autoStart !== 'boolean')
    throw new Error('Invalid login preference');
  if (
    'refreshSeconds' in patch &&
    (typeof patch.refreshSeconds !== 'number' ||
      !Number.isInteger(patch.refreshSeconds) ||
      patch.refreshSeconds < 30 ||
      patch.refreshSeconds > 900)
  )
    throw new Error('Refresh interval must be 30–900 seconds');
  if (
    'cliPath' in patch &&
    (typeof patch.cliPath !== 'string' ||
      patch.cliPath.length > 4096 ||
      /[\r\n\0]/.test(patch.cliPath))
  )
    throw new Error('Invalid CLI path');
  return patch as SettingsPatch;
}
