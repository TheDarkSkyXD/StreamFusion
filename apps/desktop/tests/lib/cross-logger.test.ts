/**
 * Guards the process-safe cross-logger that dual-use backend files
 * (e.g. mod-log-writer) use instead of `@backend/logging/logger`. Importing
 * the backend logger from renderer-reachable code drags `electron-log/main`
 * into the renderer bundle and crashes boot — this module is the workaround,
 * so any regression in its sink-selection logic would resurrect that crash.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { logger, setMainLogSink } from "@shared/utils/cross-logger";

function installRendererBridge(write: ReturnType<typeof vi.fn>) {
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: { electronAPI: { logs: { write } } },
    });
}

describe("cross-logger", () => {
    afterEach(() => {
        setMainLogSink(null);
        Reflect.deleteProperty(globalThis, "window");
        vi.restoreAllMocks();
    });

    describe("when a main sink is registered", () => {
        it("forwards every level to the sink with the right args", () => {
            const sink = vi.fn();
            setMainLogSink(sink);

            logger.debug("Tag", "d", { a: 1 });
            logger.info("Tag", "i");
            logger.warn("Tag", "w", { b: 2 });
            logger.error("Tag", "e");

            expect(sink).toHaveBeenCalledTimes(4);
            expect(sink).toHaveBeenNthCalledWith(1, "debug", "Tag", "d", { a: 1 });
            expect(sink).toHaveBeenNthCalledWith(2, "info", "Tag", "i", undefined);
            expect(sink).toHaveBeenNthCalledWith(3, "warn", "Tag", "w", { b: 2 });
            expect(sink).toHaveBeenNthCalledWith(4, "error", "Tag", "e", undefined);
        });

        it("falls back to console when the sink throws", () => {
            const sink = vi.fn(() => {
                throw new Error("sink down");
            });
            const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
            setMainLogSink(sink);

            logger.error("Tag", "msg");

            expect(sink).toHaveBeenCalled();
            expect(errSpy).toHaveBeenCalledWith("[Tag]", "msg");
        });
    });

    describe("when running in a renderer-like context", () => {
        it("forwards to window.electronAPI.logs.write", () => {
            const write = vi.fn();
            installRendererBridge(write);

            logger.warn("Tag", "msg", { x: 1 });

            expect(write).toHaveBeenCalledWith({
                level: "warn",
                tag: "Tag",
                message: "msg",
                meta: { x: 1 },
            });
        });

        it("omits meta from the payload when caller did not pass any", () => {
            const write = vi.fn();
            installRendererBridge(write);

            logger.info("Tag", "msg");

            expect(write).toHaveBeenCalledWith({ level: "info", tag: "Tag", message: "msg" });
        });

        it("falls back to console when the bridge throws", () => {
            const write = vi.fn(() => {
                throw new Error("bridge down");
            });
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            installRendererBridge(write);

            logger.warn("Tag", "msg");

            expect(write).toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledWith("[Tag]", "msg");
        });
    });

    describe("when no sink and no bridge are available", () => {
        it("falls back to console[level] preserving the tag prefix", () => {
            const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

            logger.info("Boot", "ready");

            expect(infoSpy).toHaveBeenCalledWith("[Boot]", "ready");
        });

        it("does not throw if console itself throws", () => {
            vi.spyOn(console, "error").mockImplementation(() => {
                throw new Error("console down");
            });

            expect(() => logger.error("Tag", "msg")).not.toThrow();
        });
    });

    describe("sink precedence", () => {
        it("prefers the main sink over the renderer bridge", () => {
            const sink = vi.fn();
            const write = vi.fn();
            setMainLogSink(sink);
            installRendererBridge(write);

            logger.info("Tag", "msg");

            expect(sink).toHaveBeenCalledTimes(1);
            expect(write).not.toHaveBeenCalled();
        });
    });
});
