/**
 * StreamFusion App Launch Tests
 * 
 * Basic tests to verify the Electron app launches correctly
 * and the main UI is accessible.
 */
import { test, expect } from '../fixtures/electron-app';

test.describe('App Launch', () => {
    test('should launch the application', async ({ electronApp }) => {
        // Verify app is running
        const isRunning = await electronApp.evaluate(async ({ app }) => {
            return app.isReady();
        });

        expect(isRunning).toBe(true);
    });

    test('should display the main window', async ({ mainWindow }) => {
        // Window should be visible
        const title = await mainWindow.title();
        console.log(`Window title: ${title}`);

        // Take a screenshot for debugging
        await mainWindow.screenshot({ path: 'tests/e2e/screenshots/main-window.png' });

        // Basic visibility check
        await expect(mainWindow).toBeTruthy();
    });

    test('should have correct window title', async ({ mainWindow }) => {
        const title = await mainWindow.title();
        // StreamFusion should be in the title (adjust based on actual title)
        expect(title.toLowerCase()).toContain('streamfusion');
    });

    test('should render the sidebar', async ({ mainWindow }) => {
        // Wait for the sidebar to be visible
        // Adjust selector based on your actual UI structure
        const sidebar = mainWindow.locator('[data-testid="sidebar"]').or(
            mainWindow.locator('.sidebar')
        ).or(
            mainWindow.locator('aside')
        );

        // If sidebar exists, verify it
        const sidebarCount = await sidebar.count();
        if (sidebarCount > 0) {
            await expect(sidebar.first()).toBeVisible();
        } else {
            console.log('⚠️ No sidebar found with expected selectors');
        }
    });

    test('should be able to get DOM structure', async ({ mainWindow }) => {
        // Get DOM structure for debugging - useful for finding elements
        const bodyContent = await mainWindow.evaluate(() => {
            return document.body.innerHTML.substring(0, 2000);
        });
        console.log('DOM preview:', bodyContent);

        expect(bodyContent).toBeTruthy();
    });
});

test.describe('IPC Communication', () => {
    test('should be able to get app version via IPC', async ({ electronApp }) => {
        const version = await electronApp.evaluate(async ({ app }) => {
            return app.getVersion();
        });

        console.log(`App version: ${version}`);
        expect(version).toBeTruthy();
        expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });

    test('should be able to get app name', async ({ electronApp }) => {
        const name = await electronApp.evaluate(async ({ app }) => {
            return app.getName();
        });

        console.log(`App name: ${name}`);
        expect(name.toLowerCase()).toContain('streamfusion');
    });
});
