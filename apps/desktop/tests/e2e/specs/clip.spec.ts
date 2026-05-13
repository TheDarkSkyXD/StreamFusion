import { expect, test } from '../fixtures/electron-app';

test.describe('Clip page', () => {
  test('mounts when navigated to a clip route', async ({ mainWindow }) => {
    await mainWindow.evaluate(() => {
      window.location.hash = '/clip/twitch/clip-0';
    });
    await expect(mainWindow.getByText(/playing clip/i)).toBeVisible({ timeout: 10_000 });
  });

  test('shows Share and Follow action buttons', async ({ mainWindow }) => {
    await mainWindow.evaluate(() => {
      window.location.hash = '/clip/twitch/clip-0';
    });
    await expect(mainWindow.getByRole('button', { name: /share/i })).toBeVisible();
    await expect(mainWindow.getByRole('button', { name: /follow/i })).toBeVisible();
  });
});
