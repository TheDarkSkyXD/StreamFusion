import { expect, test } from '../fixtures/electron-app';
import { AppNavigation } from '../page-objects/AppNavigation';

test.describe('MultiStream page', () => {
  test('renders the toolbar with Add Stream and layout buttons', async ({ mainWindow }) => {
    const nav = new AppNavigation(mainWindow);
    await nav.open('/multistream');
    await expect(mainWindow.getByText(/^multistream$/i).first()).toBeVisible();
    await expect(mainWindow.getByRole('button', { name: /add stream/i })).toBeVisible();
  });

  test('focus layout button is disabled with no streams', async ({ mainWindow }) => {
    const nav = new AppNavigation(mainWindow);
    await nav.open('/multistream');
    const focusBtn = mainWindow.getByTitle(/focus layout/i);
    await expect(focusBtn).toBeDisabled();
  });
});
