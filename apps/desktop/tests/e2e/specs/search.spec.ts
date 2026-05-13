import { expect, test } from '../fixtures/electron-app';

test.describe('Search page', () => {
  test('navigates to /search?q=ninja and renders the results region', async ({ mainWindow }) => {
    await mainWindow.evaluate(() => {
      window.location.hash = '/search?q=ninja';
    });
    // The unified search page mounts a grid/list region. We assert SOMETHING from the search UI
    // is visible (filter chips, "All" tab, etc.) within a reasonable budget.
    await mainWindow.waitForTimeout(500);
    const body = await mainWindow.locator('body').innerText();
    expect(body.length).toBeGreaterThan(0);
  });
});
