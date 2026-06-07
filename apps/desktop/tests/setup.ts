import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Global no-op logger mock — backend files imported in tests freely call
// logger.* without first calling initLogger(), which would throw. Individual
// test files can still call vi.mock() to override with assertions.
vi.mock('@/backend/logging/logger', async () => {
    const actual = await vi.importActual<typeof import('../src/backend/logging/logger')>(
        '@/backend/logging/logger'
    );
    return {
        ...actual,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
});
vi.mock('@/backend/logging/noise-logger', async () => {
    const actual = await vi.importActual<typeof import('../src/backend/logging/noise-logger')>(
        '@/backend/logging/noise-logger'
    );
    return {
        ...actual,
        noiseLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
});

// Mock matchMedia for Radix UI
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), // deprecated
        removeListener: vi.fn(), // deprecated
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
});

// jsdom is missing ResizeObserver / IntersectionObserver / scrollIntoView —
// Radix and TanStack Virtual reach for them.
if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
        observe() { }
        unobserve() { }
        disconnect() { }
    } as unknown as typeof ResizeObserver;
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
    globalThis.IntersectionObserver = class {
        root = null;
        rootMargin = '';
        thresholds = [];
        observe() { }
        unobserve() { }
        disconnect() { }
        takeRecords() { return []; }
    } as unknown as typeof IntersectionObserver;
}

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () { };
}

// jsdom doesn't implement PointerEvent — Radix Select uses pointer events.
if (typeof globalThis.PointerEvent === 'undefined') {
    // biome-ignore lint/suspicious/noExplicitAny: minimal polyfill
    globalThis.PointerEvent = class extends MouseEvent { } as any;
}

// Some Radix primitives call hasPointerCapture / releasePointerCapture in jsdom.
if (typeof Element !== 'undefined') {
    if (!Element.prototype.hasPointerCapture) {
        Element.prototype.hasPointerCapture = function () { return false; };
    }
    if (!Element.prototype.releasePointerCapture) {
        Element.prototype.releasePointerCapture = function () { };
    }
    if (!Element.prototype.setPointerCapture) {
        Element.prototype.setPointerCapture = function () { };
    }
}
