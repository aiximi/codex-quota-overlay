import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dateTime,
  duration,
  localDateInput,
  percent,
  remainingPercent,
  validTimestamp,
  windowLabel,
} from '../../src/renderer/format';

test('quota formatting clamps percentages and does not present invalid numbers as available quota', () => {
  assert.equal(remainingPercent(23), 77);
  assert.equal(remainingPercent(-4), 100);
  assert.equal(remainingPercent(120), 0);
  assert.equal(remainingPercent(NaN), null);
  assert.equal(percent(null), '—');
  assert.equal(percent(Infinity), '—');
});

test('date formatting distinguishes unavailable timestamps from real dates', () => {
  assert.equal(validTimestamp(null), false);
  assert.equal(validTimestamp(Infinity), false);
  assert.equal(validTimestamp(9e20), false);
  assert.equal(validTimestamp(0), true);
  assert.equal(dateTime(null, 'en'), 'Not provided');
  assert.equal(dateTime(NaN, 'zh-CN'), '未提供');
  assert.equal(localDateInput(NaN), '');
  const timestamp = new Date(2026, 9, 11, 14, 5).getTime();
  assert.equal(localDateInput(timestamp), '2026-10-11T14:05');
});

test('countdowns are nonnegative and readable in both languages', () => {
  assert.equal(duration(-5000, 'en'), '0s');
  assert.equal(duration(0, 'zh-CN'), '0秒');
  assert.equal(duration(90061000, 'en'), '1d 1h');
  assert.equal(duration(61000, 'zh-CN'), '1分 1秒');
  assert.equal(duration(NaN, 'en'), '—');
});

test('window labels use returned durations rather than assuming every account has two windows', () => {
  assert.equal(
    windowLabel({ usedPercent: 0, windowDurationMins: 10080, resetsAt: null }, 'en'),
    'Weekly',
  );
  assert.equal(
    windowLabel({ usedPercent: 0, windowDurationMins: 300, resetsAt: null }, 'zh-CN'),
    '5 小时额度',
  );
  assert.equal(
    windowLabel({ usedPercent: 0, windowDurationMins: null, resetsAt: null }, 'en'),
    'Usage',
  );
});
