/**
 * Main Window Page Object
 * 
 * Provides a clean API for interacting with StreamFusion's main window.
 * Use this in tests to keep selectors and interactions organized.
 */
import { Page, Locator } from '@playwright/test';

export class MainWindow {
    readonly page: Page;

    // Layout elements
    readonly sidebar: Locator;
    readonly mainContent: Locator;
    readonly titleBar: Locator;

    // Navigation
    readonly followingTab: Locator;
    readonly browseTab: Locator;
    readonly settingsButton: Locator;

    // Stream viewer
    readonly streamPlayer: Locator;
    readonly chatPanel: Locator;

    // Multiview
    readonly multiviewContainer: Locator;

    constructor(page: Page) {
        this.page = page;

        // Layout - adjust selectors based on actual UI
        this.sidebar = page.locator('[data-testid="sidebar"], .sidebar, aside').first();
        this.mainContent = page.locator('[data-testid="main-content"], .main-content, main').first();
        this.titleBar = page.locator('[data-testid="title-bar"], .title-bar').first();

        // Navigation
        this.followingTab = page.locator('[data-testid="following-tab"], [aria-label*="following"]').first();
        this.browseTab = page.locator('[data-testid="browse-tab"], [aria-label*="browse"]').first();
        this.settingsButton = page.locator('[data-testid="settings-button"], [aria-label*="settings"]').first();

        // Stream viewer
        this.streamPlayer = page.locator('[data-testid="stream-player"], .stream-player, video').first();
        this.chatPanel = page.locator('[data-testid="chat-panel"], .chat-panel').first();

        // Multiview
        this.multiviewContainer = page.locator('[data-testid="multiview"], .multiview-container').first();
    }

    /**
     * Get the window title
     */
    async getTitle(): Promise<string> {
        return this.page.title();
    }

    /**
     * Take a screenshot of the current state
     */
    async screenshot(name: string): Promise<Buffer> {
        return this.page.screenshot({
            path: `tests/e2e/screenshots/${name}.png`,
            fullPage: true,
        });
    }

    /**
     * Navigate to the Following section
     */
    async navigateToFollowing(): Promise<void> {
        await this.followingTab.click();
        await this.page.waitForLoadState('networkidle');
    }

    /**
     * Navigate to the Browse section
     */
    async navigateToBrowse(): Promise<void> {
        await this.browseTab.click();
        await this.page.waitForLoadState('networkidle');
    }

    /**
     * Open settings
     */
    async openSettings(): Promise<void> {
        await this.settingsButton.click();
        await this.page.waitForSelector('[data-testid="settings-dialog"], .settings-dialog');
    }

    /**
     * Search for a channel or streamer
     */
    async search(query: string): Promise<void> {
        const searchInput = this.page.locator('[data-testid="search-input"], input[type="search"], [placeholder*="search"]').first();
        await searchInput.fill(query);
        await searchInput.press('Enter');
        await this.page.waitForLoadState('networkidle');
    }

    /**
     * Click on a stream card by streamer name
     */
    async clickStream(streamerName: string): Promise<void> {
        const streamCard = this.page.locator(`[data-testid="stream-card"]:has-text("${streamerName}")`).or(
            this.page.locator(`.stream-card:has-text("${streamerName}")`)
        ).first();
        await streamCard.click();
    }

    /**
     * Get all visible stream cards
     */
    async getVisibleStreams(): Promise<string[]> {
        const cards = this.page.locator('[data-testid="stream-card"], .stream-card');
        const count = await cards.count();
        const streams: string[] = [];

        for (let i = 0; i < count; i++) {
            const text = await cards.nth(i).textContent();
            if (text) streams.push(text);
        }

        return streams;
    }

    /**
     * Check if a stream is currently playing
     */
    async isStreamPlaying(): Promise<boolean> {
        const video = this.page.locator('video');
        const count = await video.count();

        if (count === 0) return false;

        // Check if video is actually playing
        const isPlaying = await video.first().evaluate((el: HTMLVideoElement) => {
            return !el.paused && !el.ended && el.readyState > 2;
        });

        return isPlaying;
    }

    /**
     * Get DOM structure for debugging
     */
    async getDOMSnapshot(): Promise<string> {
        return this.page.evaluate(() => {
            return document.body.innerHTML.substring(0, 5000);
        });
    }

    /**
     * Wait for app to be fully loaded
     */
    async waitForAppReady(): Promise<void> {
        // Wait for the main layout to be visible
        await this.sidebar.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
            console.log('Sidebar not found - might be collapsed or different layout');
        });

        await this.mainContent.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
            console.log('Main content not found');
        });
    }
}
