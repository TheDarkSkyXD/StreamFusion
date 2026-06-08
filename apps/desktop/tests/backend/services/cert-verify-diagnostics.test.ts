/**
 * cert-verify-diagnostics.test.ts
 *
 * Guards the diagnostic-only cert-verify proc installed across EVERY Electron
 * session. The C++ ssl_client_socket layer logs net errors without the URL,
 * so this hook captures the hostname on validation failures and routes them
 * through the structured logger pipeline. Trust is never overridden —
 * callback(-3) defers to the platform default in all cases.
 *
 * Invariants pinned here:
 *   1. registerCertVerifyDiag installs the proc on the passed session exactly
 *      once.
 *   2. A failing request lands on logger.warn with the [cert-debug-r8a2] tag
 *      and the structured hostname / errorCode / verificationResult fields.
 *   3. A successful request does NOT log a warning.
 *   4. The proc always calls callback(-3) — both on success and failure.
 *   5. attachCertVerifyDiagToAllSessions wires the default session immediately
 *      AND registers exactly one app.on("session-created", ...) listener.
 *   6. The session-created listener installs the proc on each new session.
 */

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/backend/logging/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

type LoggerMock = {
  debug: Mock;
  info: Mock;
  warn: Mock;
  error: Mock;
};

type CertVerifyModule = typeof import("@/backend/services/cert-verify-diagnostics");
type CertVerifyProc = NonNullable<Parameters<Electron.Session["setCertificateVerifyProc"]>[0]>;

async function freshModule(): Promise<{ mod: CertVerifyModule; logger: LoggerMock }> {
  vi.resetModules();
  const mod = await import("@/backend/services/cert-verify-diagnostics");
  const { logger } = (await import("@/backend/logging/logger")) as unknown as {
    logger: LoggerMock;
  };
  logger.debug.mockReset();
  logger.info.mockReset();
  logger.warn.mockReset();
  logger.error.mockReset();
  return { mod, logger };
}

function makeMockSession(): { setCertificateVerifyProc: Mock } {
  return { setCertificateVerifyProc: vi.fn() };
}

function makeMockApp(): { on: Mock } {
  return { on: vi.fn() };
}

function installedProc(session: { setCertificateVerifyProc: Mock }): CertVerifyProc {
  return session.setCertificateVerifyProc.mock.calls[0][0] as CertVerifyProc;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("registerCertVerifyDiag — install", () => {
  it("calls session.setCertificateVerifyProc exactly once", async () => {
    const { mod } = await freshModule();
    const session = makeMockSession();
    mod.registerCertVerifyDiag(session as unknown as Electron.Session);
    expect(session.setCertificateVerifyProc).toHaveBeenCalledTimes(1);
  });
});

describe("registerCertVerifyDiag — proc behavior on failure", () => {
  it("routes a failing request to logger.warn with the [cert-debug-r8a2] tag and structured meta", async () => {
    const { mod, logger } = await freshModule();
    const session = makeMockSession();
    mod.registerCertVerifyDiag(session as unknown as Electron.Session);

    installedProc(session)(
      {
        hostname: "status.kick.com",
        errorCode: -202,
        verificationResult: "net::ERR_CERT_AUTHORITY_INVALID",
        isIssuedByKnownRoot: false,
      } as never,
      vi.fn()
    );

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [tag, message, meta] = logger.warn.mock.calls[0];
    expect(tag).toBe("CertVerify");
    expect(message).toContain("[cert-debug-r8a2]");
    expect(meta).toEqual(
      expect.objectContaining({
        hostname: "status.kick.com",
        errorCode: -202,
        verificationResult: "net::ERR_CERT_AUTHORITY_INVALID",
        isIssuedByKnownRoot: false,
      })
    );
  });

  it("does NOT call logger.warn for a successful verification", async () => {
    const { mod, logger } = await freshModule();
    const session = makeMockSession();
    mod.registerCertVerifyDiag(session as unknown as Electron.Session);

    installedProc(session)(
      {
        hostname: "api.twitch.tv",
        errorCode: 0,
        verificationResult: "net::OK",
        isIssuedByKnownRoot: true,
      } as never,
      vi.fn()
    );

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("always calls callback(-3) on both failure and success paths", async () => {
    const { mod } = await freshModule();
    const session = makeMockSession();
    mod.registerCertVerifyDiag(session as unknown as Electron.Session);
    const proc = installedProc(session);

    const failureCallback = vi.fn();
    proc(
      {
        hostname: "status.kick.com",
        errorCode: -202,
        verificationResult: "net::ERR_CERT_AUTHORITY_INVALID",
        isIssuedByKnownRoot: false,
      } as never,
      failureCallback
    );
    expect(failureCallback).toHaveBeenCalledWith(-3);

    const successCallback = vi.fn();
    proc(
      {
        hostname: "api.twitch.tv",
        errorCode: 0,
        verificationResult: "net::OK",
        isIssuedByKnownRoot: true,
      } as never,
      successCallback
    );
    expect(successCallback).toHaveBeenCalledWith(-3);
  });
});

describe("attachCertVerifyDiagToAllSessions", () => {
  it("installs the proc on the default session immediately and registers exactly one session-created listener", async () => {
    const { mod } = await freshModule();
    const app = makeMockApp();
    const defaultSession = makeMockSession();

    mod.attachCertVerifyDiagToAllSessions(
      app as unknown as Electron.App,
      defaultSession as unknown as Electron.Session
    );

    expect(defaultSession.setCertificateVerifyProc).toHaveBeenCalledTimes(1);
    const sessionCreatedCalls = app.on.mock.calls.filter((c) => c[0] === "session-created");
    expect(sessionCreatedCalls).toHaveLength(1);
  });

  it("installs the proc on each session passed to the session-created listener", async () => {
    const { mod } = await freshModule();
    const app = makeMockApp();
    const defaultSession = makeMockSession();

    mod.attachCertVerifyDiagToAllSessions(
      app as unknown as Electron.App,
      defaultSession as unknown as Electron.Session
    );

    const handler = app.on.mock.calls.find((c) => c[0] === "session-created")?.[1] as (
      session: Electron.Session
    ) => void;
    expect(handler).toBeDefined();

    const newSession = makeMockSession();
    handler(newSession as unknown as Electron.Session);
    expect(newSession.setCertificateVerifyProc).toHaveBeenCalledTimes(1);
  });
});
