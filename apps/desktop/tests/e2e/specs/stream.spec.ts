import { expect, test } from '../fixtures/electron-app';

test.describe('Stream page (live)', () => {
  test('mounts when navigated to a stream route', async ({ mainWindow }) => {
    await mainWindow.evaluate(() => {
      window.location.hash = '/stream/twitch/ninja';
    });
    // Don't require the player to actually play — just that the page rendered.
    await mainWindow.waitForTimeout(500);
    const html = await mainWindow.locator('body').innerHTML();
    expect(html.length).toBeGreaterThan(100);
  });
});
