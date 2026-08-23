import '@testing-library/jest-dom';
import { vi } from 'vitest';
import './setup-node';

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

// jsdom defines these methods but reports every call as "not implemented".
// Tests that need behavior replace the no-op with a file-local spy.
if (typeof window !== 'undefined') {
    window.scrollTo = vi.fn();
}

if (typeof HTMLMediaElement !== 'undefined') {
    HTMLMediaElement.prototype.load = vi.fn();
    HTMLMediaElement.prototype.pause = vi.fn();
}

// jsdom doesn't implement PointerEvent — Radix Select uses pointer events.
if (typeof globalThis.PointerEvent === 'undefined') {
    globalThis.PointerEvent = class extends MouseEvent { } as typeof PointerEvent;
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
