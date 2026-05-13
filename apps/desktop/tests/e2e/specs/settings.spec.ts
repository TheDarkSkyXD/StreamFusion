import { expect, test } from '../fixtures/electron-app';
import { AppNavigation } from '../page-objects/AppNavigation';

test.describe('Settings page', () => {
  test('mounts and exposes the app version somewhere', async ({ mainWindow }) => {
    const nav = new AppNavigation(mainWindow);
    await nav.open('/settings');
    // Settings page renders the AccountConnect block and a version somewhere.
    await expect(mainWindow.locator('body')).toContainText(/version/i, { timeout: 10_000 });
  });
});
