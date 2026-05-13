import { expect, test } from '../fixtures/electron-app';

test.describe('Category Detail page', () => {
  test('mounts when navigated to a category route', async ({ mainWindow }) => {
    // Use a likely-valid Twitch slug; if the API returns no data, the page still mounts.
    await mainWindow.evaluate(() => {
      window.location.hash = '/categories/twitch/509658';
    });
    // We only assert the page rendered some chrome (loading skeleton or back-link).
    await expect(
      mainWindow.locator('a:has-text("Back to Categories"), .animate-pulse').first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
