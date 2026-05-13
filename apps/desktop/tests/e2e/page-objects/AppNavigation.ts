/**
 * AppNavigation Page Object
 *
 * Shared sidebar navigation actions used by every per-page spec.
 * The sidebar links use TanStack Router hash routing — clicking just
 * sets the hash, no real navigation; we wait on the resulting heading.
 */
import type { Page } from '@playwright/test';

export class AppNavigation {
  constructor(private readonly page: Page) {}

  async open(path: '/' | '/following' | '/categories' | '/multistream' | '/history' | '/downloads' | '/settings') {
    // Hash routing: `/#/categories` etc.
    const target = path === '/' ? '#/' : `#${path}`;
    await this.page.evaluate((href) => {
      window.location.hash = href.replace(/^#/, '');
    }, target);
    await this.page.waitForTimeout(150);
  }

  async clickNavItem(label: string) {
    await this.page.getByRole('link', { name: label, exact: true }).first().click();
  }

  async waitForHeading(name: string | RegExp) {
    await this.page.getByRole('heading', { name }).first().waitFor({ state: 'visible', timeout: 10_000 });
  }
}
