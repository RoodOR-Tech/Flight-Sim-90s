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

  test('mission 2 loads the armoured column and bombs can be released', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');
    await expect(page.locator('#title-start-btn')).toBeVisible({ timeout: 20000 });
    await page.click('#title-start-btn');
    await page.click('[data-mission="iron_anvil"]');
    await expect(page.locator('#briefing-title')).toHaveText('OPERATION IRON ANVIL');
    await page.check('#skip-launch-checkbox');
    await page.click('#briefing-start-btn');
    await expect(page.locator('.hud-canvas')).toBeVisible({ timeout: 10000 });

    await expect.poll(async () => (await readSceneState(page)).missionStage, { timeout: 20000 }).toBe('to_alpha');
    const state = await readSceneState(page);
    expect(state.missionId).toBe('iron_anvil');
    expect(state.groundUnits.filter((u: any) => u.kind === 'tank' && u.alive)).toHaveLength(6);
    expect(state.groundUnits.filter((u: any) => u.kind === 'flak' && u.alive)).toHaveLength(2);
    // Vehicles sit on land, not at sea level.
    for (const u of state.groundUnits) expect(u.position[1]).toBeGreaterThan(10);
    expect(state.bombs).toBe(6);
    expect(state.enemyCount).toBe(0);

    await page.keyboard.press('KeyX');
    await expect.poll(async () => (await readSceneState(page)).bombs, { timeout: 15000 }).toBe(5);

    // Restart keeps the same mission and restores the loadout.
    await page.keyboard.press('KeyP');
    await page.click('#pause-restart-btn');
    await expect.poll(async () => (await readSceneState(page)).bombs, { timeout: 15000 }).toBe(6);
    expect((await readSceneState(page)).missionId).toBe('iron_anvil');

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

test('a trimmed practice approach catches a wire and can be flown again', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto('/');
  await page.click('#title-start-btn');
  await page.click('[data-mission="carrier_practice"]');
  await expect(page.locator('#skip-launch-checkbox')).toBeHidden();
  await page.click('#briefing-start-btn');
  const state = await readSceneState(page);
  expect(state.missionStage).toBe('landing');
  expect(state.gearDown && state.flapsDown).toBe(true);
  expect([state.enemyCount, state.groundUnits.length, state.cannonAmmo, state.missiles, state.bombs]).toEqual([0, 0, 0, 0, 0]);

  await expect(page.getByRole('heading', { name: 'WIRE CAUGHT' })).toBeVisible({ timeout: 90000 });
  await expect(page.getByText('AT TOUCHDOWN')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('obb.best.v1'))).toBeNull();
  await page.getByRole('button', { name: 'FLY AGAIN' }).click();
  expect((await readSceneState(page)).missionStage).toBe('landing');
});

test('an uncorrected offset approach gives a specific debrief and returns to mission selection', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto('/');
  await page.click('#title-start-btn');
  await page.click('[data-mission="carrier_practice"]');
  await page.selectOption('#practice-approach', 'offset');
  await page.click('#briefing-start-btn');
  await expect(page.getByText('Passed the wires wide of the deck.')).toBeVisible({ timeout: 90000 });
  await expect(page.getByText('AT TOUCHDOWN')).toBeHidden();
  await page.click('#results-briefing-btn');
  await page.click('[data-mission="broken_beacon"]');
  await expect(page.locator('#practice-approach')).toBeHidden();
  await page.check('#skip-launch-checkbox');
  await page.click('#briefing-start-btn');
  const state = await readSceneState(page);
  expect(state.missionStage).toBe('to_alpha');
  expect(state.flapsDown).toBe(false);
  expect(state.gearDown).toBe(false);
  expect(state.cannonAmmo).toBe(240);
});

test('F1 freezes flight and returns to the underlying briefing, flight, map or pause menu', async ({ page }) => {
  await page.goto('/');
  await page.click('#title-start-btn');
  const controls = page.getByRole('dialog', { name: 'Keyboard controls' });
  const briefingButton = page.locator('#briefing-controls-btn');
  await briefingButton.click();
  await expect(controls.getByText('Hold for manual lock')).toBeVisible();
  await controls.getByRole('button', { name: 'Close' }).click();
  await expect(briefingButton).toBeFocused();
  await page.check('#skip-launch-checkbox');
  await page.click('#briefing-start-btn');
  await expect(page.locator('.hud-canvas')).toBeVisible();

  await page.keyboard.down('F1');
  await page.keyboard.down('F1');
  await page.keyboard.up('F1');
  await expect(controls).toBeVisible();
  const before = await readSceneState(page);
  for (const key of ['g', 'c', 'p', 'm']) await page.keyboard.press(key);
  await page.waitForTimeout(250);
  expect((await readSceneState(page)).position).toEqual(before.position);
  await page.keyboard.press('Escape');
  await expect(controls).toBeHidden();
  await expect.poll(async () => (await readSceneState(page)).position).not.toEqual(before.position);
  const after = await readSceneState(page);
  expect(after.screen).toBe('playing');
  expect(after.gearDown).toBe(before.gearDown);
  expect(after.cameraMode).toBe(before.cameraMode);

  await page.keyboard.press('m');
  const map = page.getByRole('heading', { name: 'TACTICAL MAP' });
  await expect(map).toBeVisible();
  await page.keyboard.press('F1');
  await expect(controls).toBeVisible();
  await page.keyboard.press('F1');
  await expect(controls).toBeHidden();
  await expect(map).toBeVisible();
  await page.keyboard.press('m');
  await expect(map).toBeHidden();
  await page.keyboard.press('p');
  await page.locator('#pause-controls-btn').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-resume-btn')).toBeVisible();
  expect((await readSceneState(page)).paused).toBe(true);
});
