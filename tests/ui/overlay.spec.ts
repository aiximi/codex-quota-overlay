import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

test('offline preview is clickable, resets stay disabled, and settings change language', async ({}, testInfo) => {
  const profile = await mkdtemp(resolve(tmpdir(), 'codex-quota-ui-'));
  // Explicitly avoid inheriting Electron's CLI mode from a parent editor process.
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') environment[key] = value;
  }
  environment.QUOTA_USER_DATA_DIR = profile;
  const app = await electron.launch({ args: ['.', '--preview'], env: environment });
  try {
    const overlay = await app.firstWindow();
    const pageErrors: string[] = [];
    overlay.on('pageerror', (error) => pageErrors.push(error.message));
    const toggle = overlay.locator('#toggle-expanded');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(overlay.locator('.header-percent')).toHaveText('72%');
    const existingButton = await toggle.elementHandle();
    const unchanged = await overlay.evaluate(() => window.quota.getState());
    await app.evaluate(({ BrowserWindow }, state) => {
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().endsWith('/index.html'))
        ?.webContents.send('quota:updated', state);
    }, unchanged);
    await overlay.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    expect(await existingButton!.evaluate((node) => node.isConnected)).toBe(true);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(overlay.locator('.preview-badge')).toBeVisible();
    await expect(overlay.locator('.reset-row')).toHaveCount(2);
    await expect(overlay.locator('.subscription-date')).toBeInViewport({ ratio: 1 });
    await expect(overlay.locator('.subscription-meta')).toBeInViewport({ ratio: 1 });
    const resetButtons = overlay.locator('.reset-button');
    await expect(resetButtons.nth(0)).toBeDisabled();
    await expect(resetButtons.nth(1)).toBeDisabled();

    // Keyboard activation and repeated pointer clicks use the same large hit target.
    await toggle.focus();
    await toggle.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    for (let count = 0; count < 3; count += 1) {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    }
    await toggle.click();
    await overlay.locator('#refresh-usage').click();
    await expect(resetButtons.nth(0)).toBeDisabled();
    await overlay.screenshot({ path: testInfo.outputPath('overlay-preview.png') });

    const settingsCreated = app.waitForEvent('window');
    await overlay.locator('#open-settings').click();
    const settings = await settingsCreated;
    settings.on('pageerror', (error) => pageErrors.push(error.message));
    await expect(settings.locator('#language')).toBeVisible();
    await settings.locator('#language').selectOption('en');
    await settings.locator('.settings-form button[type="submit"]').click();
    await expect(settings.locator('h1')).toHaveText('Preferences');
    await expect(overlay.locator('h1')).toHaveText('Usage overview');
    await expect(settings.locator('.settings-status')).toHaveText('Preferences saved.');
    await expect(overlay.locator('.subscription-date')).toBeInViewport({ ratio: 1 });
    await overlay.screenshot({ path: testInfo.outputPath('overlay-preview-en.png') });
    await settings.screenshot({
      path: testInfo.outputPath('settings-preview.png'),
      fullPage: true,
    });

    await settings.locator('#language').selectOption('zh-CN');
    await settings.locator('.settings-form button[type="submit"]').click();
    await expect(settings.locator('h1')).toHaveText('偏好设置');
    await expect(overlay.locator('h1')).toHaveText('额度概览');
    await expect(overlay.locator('.reset-button').first()).toBeDisabled();
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
