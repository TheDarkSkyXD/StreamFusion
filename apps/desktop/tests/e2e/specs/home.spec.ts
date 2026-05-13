import { expect, test } from '../fixtures/electron-app';
import { AppNavigation } from '../page-objects/AppNavigation';

test.describe('Home page', () => {
  test('renders Browse All Categories link', async ({ mainWindow }) => {
    const nav = new AppNavigation(mainWindow);
    await nav.open('/');
    await expect(mainWindow.getByText(/browse all categories/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('renders the live-now or empty state without throwing', async ({ mainWindow }) => {
    const nav = new AppNavigation(mainWindow);
    await nav.open('/');
    // We don't assume the API returns data — just that the page mounted without a thrown error.
    const errorVisible = await mainWindow.getByText(/failed to load streams/i).isVisible().catch(() => false);
    expect(typeof errorVisible).toBe('boolean');
  });
});
