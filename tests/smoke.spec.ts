import { test, expect, Page } from '@playwright/test';

/**
 * Browser smoke test. Confirms the whole boot path works and the scene actually contains the
 * player and carrier, then that a mission can be restarted without reloading the page.
 *
 * Note on WebGL: CI-style headless Chromium runs on SwiftShader, so this asserts on scene state and
 * absence of errors rather than on pixels.
 */

/** Reads live scene state that the game exposes for testing/diagnostics. */
async function readSceneState(page: Page) {
  return page.evaluate(() => (window as any).__obbTestState?.() ?? null);
}

async function startMission(page: Page, { skipLaunch = true } = {}) {
  await expect(page.locator('#title-start-btn')).toBeVisible({ timeout: 20000 });
  await page.click('#title-start-btn');
  await expect(page.locator('#briefing-start-btn')).toBeVisible({ timeout: 10000 });
  if (skipLaunch) await page.check('#skip-launch-checkbox');
  await page.click('#briefing-start-btn');
  await expect(page.locator('.hud-canvas')).toBeVisible({ timeout: 10000 });
}

test.describe('Operation Broken Beacon smoke test', () => {
  test('boots, loads the world, flies, and restarts without a page reload', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // 1. Page loads and the canvas exists.
    await page.goto('/');
    await expect(page.locator('#scene-canvas')).toBeAttached();

    // 2. Loading screen gives way to the title screen.
    await expect(page.locator('#title-start-btn')).toBeVisible({ timeout: 20000 });

    // 3. Briefing opens with its controls.
    await page.click('#title-start-btn');
    await expect(page.locator('#briefing-start-btn')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-diff="normal"]')).toBeVisible();

    // 4. Mission starts and the HUD appears.
    await page.check('#skip-launch-checkbox');
    await page.click('#briefing-start-btn');
    await expect(page.locator('.hud-canvas')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#briefing-start-btn')).toBeHidden();

    // Let the simulation run so the render loop and physics are exercised.
    await page.waitForTimeout(2500);

    // 5-6. The player entity and the carrier are present in the scene.
    const state = await readSceneState(page);
    expect(state, 'the game should expose test state').not.toBeNull();
    expect(state.playerLoaded, 'player aircraft should be in the scene').toBe(true);
    expect(state.carrierLoaded, 'carrier should be in the scene').toBe(true);
    expect(state.radarSiteLoaded, 'radar site should be in the scene').toBe(true);
    expect(state.screen).toBe('playing');
    // The aircraft should actually be flying, not sitting at the origin.
    expect(state.altitude, 'aircraft should be airborne').toBeGreaterThan(50);
    expect(state.speed, 'aircraft should have forward speed').toBeGreaterThan(20);

    // 7. Camera modes cycle without throwing.
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('KeyC');
      await page.waitForTimeout(250);
    }

    // Tactical map opens and closes.
    await page.keyboard.press('KeyM');
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyM');
    await page.waitForTimeout(200);

    // 8. Mission can be restarted from the pause menu with no page reload.
    await page.keyboard.press('KeyP');
    await expect(page.locator('#pause-restart-btn')).toBeVisible({ timeout: 5000 });
    await page.click('#pause-restart-btn');
    await expect(page.locator('.hud-canvas')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1200);

    const afterRestart = await readSceneState(page);
    expect(afterRestart.screen).toBe('playing');
    expect(afterRestart.playerLoaded).toBe(true);
    // Restart must restore full health and a fresh loadout.
    expect(afterRestart.health).toBe(afterRestart.maxHealth);
    expect(afterRestart.missiles).toBe(4);

    // 9. No uncaught JavaScript errors at any point.
    expect(pageErrors, `Uncaught page errors: ${pageErrors.join('; ')}`).toEqual([]);
  });

  test('the full carrier launch sequence gets the aircraft airborne', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');
    await startMission(page, { skipLaunch: false });

    // On the catapult: stationary on the deck.
    const onDeck = await readSceneState(page);
    expect(onDeck.launchPhase).toBe('onDeck');
    expect(onDeck.speed).toBeLessThan(5);

    // Advance the throttle to trigger the cat shot.
    // Wait on sim state, not wall-clock time: on a slow software-rendered runner the simulation
    // advances slower than real time, so fixed sleeps are not enough.
    await page.keyboard.down('ShiftLeft');
    await expect
      .poll(async () => (await readSceneState(page)).launchPhase, { timeout: 45000 })
      .not.toBe('onDeck');
    await page.keyboard.up('ShiftLeft');
    await expect
      .poll(async () => (await readSceneState(page)).launchPhase, { timeout: 45000 })
      .toBe('airborne');

    const airborne = await readSceneState(page);
    expect(airborne.speed, 'catapult should impart flying speed').toBeGreaterThan(50);
    expect(airborne.missionStage).not.toBe('failed');

    expect(pageErrors, `Uncaught page errors: ${pageErrors.join('; ')}`).toEqual([]);
  });

  test('settings panel exposes the graphics quality control', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#title-start-btn')).toBeVisible({ timeout: 20000 });
    await page.click('#title-start-btn');
    await expect(page.locator('#briefing-settings-btn')).toBeVisible({ timeout: 10000 });
    await page.click('#briefing-settings-btn');

    const quality = page.locator('#set-quality');
    await expect(quality).toBeVisible();
    // Switching to Low must not throw.
    await quality.selectOption('low');
    await page.waitForTimeout(400);
    await expect(page.locator('#set-perf')).toBeVisible();
    await page.click('#set-close-btn');
  });
});
