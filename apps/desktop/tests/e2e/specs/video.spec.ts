import { expect, test } from '../fixtures/electron-app';

test.describe('Video (VOD) page', () => {
  test('mounts when navigated to a VOD route with metadata in search params', async ({ mainWindow }) => {
    await mainWindow.evaluate(() => {
      const params = new URLSearchParams({
        title: 'E2E VOD Title',
        channelName: 'ninja',
        channelDisplayName: 'Ninja',
      });
      window.location.hash = `/video/twitch/vod-test?${params.toString()}`;
    });
    await expect(mainWindow.getByText(/e2e vod title/i)).toBeVisible({ timeout: 10_000 });
  });
});
