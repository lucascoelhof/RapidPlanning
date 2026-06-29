import { test, expect } from '@playwright/test';

/**
 * Smoke test: boots the app via `vite preview` (configured in
 * `playwright.config.ts`), verifies the home page renders, and that
 * a session can be created.
 *
 * Full multiplayer scenarios (multiple browser contexts dialing each other
 * through PeerJS) live in separate spec files and require either the public
 * PeerJS cloud or a local PeerServer. This file just locks in the happy path.
 */

test.describe('RapidPlanning smoke', () => {
  test('home page renders create + join forms', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('RapidPlanning');
    await expect(page.locator('#create-form')).toBeVisible();
    await expect(page.locator('#join-form')).toBeVisible();
  });

  test('about page renders terms', async ({ page }) => {
    await page.goto('/?page=about');
    await expect(page.locator('.terms-section h2')).toContainText('Terms of Use');
  });

  test('session URL without identity shows the join prompt', async ({ page }) => {
    await page.goto('/?session=123456789');
    await expect(page.locator('#join-prompt-form')).toBeVisible();
    await expect(page.locator('h2')).toContainText('123456789');
  });

  test('invalid session id falls back to home', async ({ page }) => {
    await page.goto('/?session=not-a-real-id');
    await expect(page.locator('#create-form')).toBeVisible();
  });
});
