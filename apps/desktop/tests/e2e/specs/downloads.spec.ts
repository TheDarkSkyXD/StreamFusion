import { expect, test } from '../fixtures/electron-app';
import { AppNavigation } from '../page-objects/AppNavigation';

test.describe('Downloads page', () => {
  test('renders Downloads heading and the placeholder sections', async ({ mainWindow }) => {
    const nav = new AppNavigation(mainWindow);
    await nav.open('/downloads');
    await nav.waitForHeading(/downloads/i);
    await expect(mainWindow.getByText(/active downloads/i)).toBeVisible();
    await expect(mainWindow.getByText(/completed/i)).toBeVisible();
  });
});
