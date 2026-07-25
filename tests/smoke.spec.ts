import { test, expect } from '@playwright/test';

test.describe('Operation Broken Beacon smoke test', () => {
  test('loads title, opens briefing, starts mission, and renders the game canvas with no console errors', async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');

    // Canvas must exist immediately.
    const canvas = page.locator('#scene-canvas');
    await expect(canvas).toBeAttached();

    // Loading screen should give way to the title screen.
    await expect(page.locator('#title-start-btn')).toBeVisible({ timeout: 15000 });

    await page.click('#title-start-btn');

    // Briefing screen should appear with its start button and difficulty controls.
    await expect(page.locator('#briefing-start-btn')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-diff="normal"]')).toBeVisible();

    // Skip the carrier launch for a fast, deterministic smoke test.
    await page.check('#skip-launch-checkbox');
    await page.click('#briefing-start-btn');

    // The HUD canvas should now be visible and the briefing hidden.
    await expect(page.locator('.hud-canvas')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#briefing-start-btn')).toBeHidden();

    // Let the simulation run for a couple of seconds to catch startup errors.
    await page.waitForTimeout(2000);

    expect(pageErrors, `Uncaught page errors: ${pageErrors.join('; ')}`).toEqual([]);
  });
});
