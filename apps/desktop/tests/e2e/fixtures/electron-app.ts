/**
 * Electron App Test Fixture
 * 
 * Provides fixtures for launching and interacting with the StreamFusion Electron app.
 * Exposes both the ElectronApplication instance and the main window Page.
 */
import { test as base, ElectronApplication, Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';

// Types for our custom fixtures
export interface ElectronFixtures {
    electronApp: ElectronApplication;
    mainWindow: Page;
}

/**
 * Get the path to the Electron executable based on environment
 */
function getAppPath(): string {
    const platform = process.platform;
    const rootDir = path.join(__dirname, '../../..');

    // Check if we're running against a packaged build or development
    const isPackaged = process.env.ELECTRON_IS_PACKAGED === 'true';

    if (isPackaged) {
        // Packaged app paths
        if (platform === 'win32') {
            return path.join(rootDir, 'out/StreamFusion-win32-x64/streamfusion.exe');
        } else if (platform === 'darwin') {
            return path.join(rootDir, 'out/StreamFusion-darwin-x64/StreamFusion.app/Contents/MacOS/StreamFusion');
        } else {
            return path.join(rootDir, 'out/StreamFusion-linux-x64/streamfusion');
        }
    } else {
        // Development mode - use electron directly with the main entry
        // For Vite-based Electron Forge, we need to run electron-forge start
        // But for Playwright, we launch the built output
        return path.join(rootDir, '.vite/build/main.js');
    }
}

/**
 * Extended test with Electron fixtures
 */
export const test = base.extend<ElectronFixtures>({
    electronApp: async ({ }, use) => {
        const appPath = getAppPath();
        const isPackaged = process.env.ELECTRON_IS_PACKAGED === 'true';

        console.log(`🚀 Launching Electron app from: ${appPath}`);
        console.log(`📦 Packaged mode: ${isPackaged}`);

        let electronApp: ElectronApplication;

        if (isPackaged) {
            // Launch the packaged executable
            electronApp = await electron.launch({
                executablePath: appPath,
                env: {
                    ...process.env,
                    NODE_ENV: 'test',
                },
                timeout: 30000,
            });
        } else {
            // Launch using electron binary with the Vite build output
            electronApp = await electron.launch({
                args: [appPath],
                env: {
                    ...process.env,
                    NODE_ENV: 'test',
                },
                timeout: 30000,
            });
        }

        // Wait for app to be ready
        await electronApp.evaluate(async ({ app }) => {
            return app.isReady();
        });

        console.log('✅ Electron app launched successfully');

        await use(electronApp);

        // Cleanup
        console.log('🧹 Closing Electron app...');
        await electronApp.close();
    },

    mainWindow: async ({ electronApp }, use) => {
        // Wait for the first BrowserWindow to open
        const window = await electronApp.firstWindow();

        // Wait for the DOM to be ready
        await window.waitForLoadState('domcontentloaded');

        // Optionally wait for network idle (app fully loaded)
        try {
            await window.waitForLoadState('networkidle', { timeout: 10000 });
        } catch {
            // Network idle timeout is not critical
            console.log('⚠️ Network idle timeout - continuing anyway');
        }

        console.log('🪟 Main window ready');
        console.log(`📍 URL: ${window.url()}`);

        await use(window);
    },
});

export { expect } from '@playwright/test';
export type { ElectronApplication, Page };
