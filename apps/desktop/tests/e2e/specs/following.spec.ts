import { expect, test } from '../fixtures/electron-app';
import { AppNavigation } from '../page-objects/AppNavigation';

test.describe('Following page', () => {
  test('renders the Following heading and platform filters', async ({ mainWindow }) => {
    const nav = new AppNavigation(mainWindow);
    await nav.open('/following');
    await nav.waitForHeading(/following/i);
    await expect(mainWindow.getByRole('button', { name: /^all$/i }).first()).toBeVisible();
    await expect(mainWindow.getByRole('button', { name: /twitch/i }).first()).toBeVisible();
    await expect(mainWindow.getByRole('button', { name: /kick/i }).first()).toBeVisible();
  });

  test('filters via the search input', async ({ mainWindow }) => {
    const nav = new AppNavigation(mainWindow);
    await nav.open('/following');
    const input = mainWindow.getByPlaceholder(/search followed channels/i);
    await input.fill('zzz-no-match');
    await expect(mainWindow.getByText(/no matches for "zzz-no-match"/i)).toBeVisible();
  });
});
