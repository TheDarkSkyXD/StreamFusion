import { expect, test } from '../fixtures/electron-app';
import { AppNavigation } from '../page-objects/AppNavigation';

test.describe('Sidebar navigation', () => {
  test('navigates between major pages via the sidebar', async ({ mainWindow }) => {
    const nav = new AppNavigation(mainWindow);

    await nav.open('/');
    await expect(mainWindow.getByText(/browse all categories/i).first()).toBeVisible({ timeout: 10_000 });

    await nav.open('/following');
    await nav.waitForHeading(/following/i);

    await nav.open('/categories');
    await nav.waitForHeading(/categories/i);

    await nav.open('/history');
    await nav.waitForHeading(/watch history/i);

    await nav.open('/downloads');
    await nav.waitForHeading(/downloads/i);

    await nav.open('/multistream');
    await expect(mainWindow.getByRole('button', { name: /add stream/i })).toBeVisible();
  });
});
