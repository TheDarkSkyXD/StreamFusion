import { expect, test } from '../fixtures/electron-app';
import { AppNavigation } from '../page-objects/AppNavigation';

test.describe('Categories page', () => {
  test('renders the Categories heading and filter input', async ({ mainWindow }) => {
    const nav = new AppNavigation(mainWindow);
    await nav.open('/categories');
    await nav.waitForHeading(/categories/i);
    await expect(mainWindow.getByPlaceholder(/filter categories/i)).toBeVisible();
  });

  test('filters categories by typing', async ({ mainWindow }) => {
    const nav = new AppNavigation(mainWindow);
    await nav.open('/categories');
    await mainWindow.getByPlaceholder(/filter categories/i).fill('zzznomatch');
    await expect(mainWindow.getByText(/no categories matching/i)).toBeVisible({ timeout: 10_000 });
  });
});
