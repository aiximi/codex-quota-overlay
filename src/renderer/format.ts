import type { Language, UsageWindow } from '../shared/contracts';
import { translator } from './i18n';

export function validTimestamp(value: number | null | undefined): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && !Number.isNaN(new Date(value).getTime())
  );
}

export function remainingPercent(used: number): number | null {
  return Number.isFinite(used) ? Math.min(100, Math.max(0, 100 - used)) : null;
}

export function percent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : `${Math.round(value)}%`;
}

export function dateTime(value: number | null, language: Language): string {
  if (!validTimestamp(value)) return translator(language)('unknown');
  return new Intl.DateTimeFormat(language, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value);
}

export function duration(milliseconds: number, language: Language): string {
  if (!Number.isFinite(milliseconds)) return '—';
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const units = [
    { value: Math.floor(seconds / 86400), en: 'd', zh: '天' },
    { value: Math.floor(seconds / 3600) % 24, en: 'h', zh: '小时' },
    { value: Math.floor(seconds / 60) % 60, en: 'm', zh: '分' },
    { value: seconds % 60, en: 's', zh: '秒' },
  ];
  const first = Math.max(
    0,
    units.findIndex((unit) => unit.value > 0),
  );
  const selected = seconds === 0 ? [units[3]] : units.slice(first, first + 2);
  return selected
    .map((unit) => `${unit.value}${language === 'zh-CN' ? unit.zh : unit.en}`)
    .join(' ');
}

export function windowLabel(window: UsageWindow, language: Language): string {
  const t = translator(language);
  const minutes = window.windowDurationMins;
  if (minutes === 10080) return t('weekly');
  if (minutes === 1440) return t('daily');
  if (minutes && Number.isFinite(minutes) && minutes > 0 && minutes % 60 === 0) {
    return language === 'zh-CN' ? `${minutes / 60} ${t('hours')}` : `${minutes / 60}${t('hours')}`;
  }
  return t('window');
}

/** datetime-local deliberately uses the computer's local zone, matching the displayed dates. */
export function localDateInput(timestamp: number | null): string {
  if (!validTimestamp(timestamp)) return '';
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
