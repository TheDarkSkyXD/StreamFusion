/**
 * cert-verify-diagnostics.ts
 *
 * Diagnostic-only cert-verify proc installed across EVERY Electron session
 * (default, custom partitions, and any session created later). The native
 * ssl_client_socket layer logs cert errors without the URL — without this
 * hook the session log shows ERR_CERT_AUTHORITY_INVALID with no hostname,
 * leaving real failures unattributable.
 *
 * Trust is never overridden. The proc forwards callback(-3) in every code
 * path, which defers to the platform default verifier. Tag [cert-debug-r8a2]
 * makes the block grep-removable once the offending host is identified.
 */

import type { App, Session } from "electron";

import { logger } from "@backend/logging/logger";

export function registerCertVerifyDiag(session: Session): void {
  session.setCertificateVerifyProc((request, callback) => {
    if (request.errorCode !== 0 || request.verificationResult !== "net::OK") {
      logger.warn("CertVerify", `[cert-debug-r8a2] Cert validation issue for ${request.hostname}`, {
        hostname: request.hostname,
        errorCode: request.errorCode,
        verificationResult: request.verificationResult,
        isIssuedByKnownRoot: request.isIssuedByKnownRoot,
      });
    }
    callback(-3);
  });
}

// Renderers using `partition:` and the utility/network process don't touch
// defaultSession; session-created fires for those.
export function attachCertVerifyDiagToAllSessions(app: App, defaultSession: Session): void {
  registerCertVerifyDiag(defaultSession);
  app.on("session-created", registerCertVerifyDiag);
}
