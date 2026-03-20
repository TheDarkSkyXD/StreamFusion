/**
 * Playwright Configuration for StreamFusion Electron App
 * 
 * This config enables testing the Electron app using Playwright.
 * The app must be built first with `npm run package` before running tests.
 */
import { defineConfig } from '@playwright/test';
import path from 'path';

// Path to the built Electron executable
const getElectronPath = () => {
    const platform = process.platform;
    const basePath = path.join(__dirname, '../../out/StreamFusion-win32-x64');

    if (platform === 'win32') {
        return path.join(basePath, 'streamfusion.exe');
    } else if (platform === 'darwin') {
        return path.join(__dirname, '../../out/StreamFusion-darwin-x64/StreamFusion.app/Contents/MacOS/StreamFusion');
    } else {
        return path.join(__dirname, '../../out/StreamFusion-linux-x64/streamfusion');
    }
};

export default defineConfig({
    testDir: './specs',
    fullyParallel: false, // Electron tests should run sequentially
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1, // Single worker for Electron
    reporter: [
        ['html', { outputFolder: './reports' }],
        ['list'],
    ],
    use: {
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    projects: [
        {
            name: 'electron',
            testMatch: '**/*.spec.ts',
        },
    ],
    // Global timeout for Electron app startup
    timeout: 60000,
    expect: {
        timeout: 10000,
    },
});

export { getElectronPath };
