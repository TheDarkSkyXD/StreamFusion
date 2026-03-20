/**
 * Test Utilities for StreamFusion E2E Tests
 * 
 * Helper functions for common testing operations.
 */
import { Page } from '@playwright/test';

/**
 * Wait for an element to appear with custom retry logic
 */
export async function waitForElement(
    page: Page,
    selector: string,
    options: { timeout?: number; state?: 'visible' | 'attached' } = {}
): Promise<boolean> {
    const { timeout = 10000, state = 'visible' } = options;

    try {
        await page.locator(selector).waitFor({ state, timeout });
        return true;
    } catch {
        return false;
    }
}

/**
 * Retry an action until it succeeds or times out
 */
export async function retry<T>(
    action: () => Promise<T>,
    options: { maxAttempts?: number; delayMs?: number } = {}
): Promise<T> {
    const { maxAttempts = 3, delayMs = 1000 } = options;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await action();
        } catch (error) {
            lastError = error as Error;
            console.log(`Attempt ${attempt}/${maxAttempts} failed: ${lastError.message}`);

            if (attempt < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }

    throw lastError;
}

/**
 * Get all text content from the page for debugging
 */
export async function getPageText(page: Page): Promise<string> {
    return page.evaluate(() => document.body.innerText);
}

/**
 * Log current page state for debugging
 */
export async function logPageState(page: Page): Promise<void> {
    const url = page.url();
    const title = await page.title();

    console.log('=== Page State ===');
    console.log(`URL: ${url}`);
    console.log(`Title: ${title}`);
    console.log('==================');
}

/**
 * Take a debug screenshot with timestamp
 */
export async function debugScreenshot(page: Page, prefix = 'debug'): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = `tests/e2e/screenshots/${prefix}-${timestamp}.png`;

    await page.screenshot({ path, fullPage: true });
    console.log(`📸 Screenshot saved: ${path}`);
}
