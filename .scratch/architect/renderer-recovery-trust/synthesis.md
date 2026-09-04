# Synthesis

Use the identity-only design and narrow it to the observed failure. Remove only `mainFrame.detached` from `MainRendererPortController.trustedSender()`. Keep the window, destroyed `WebContents`, crashed renderer, and destroyed `mainFrame` checks.

The bound `WebContents` is the stable renderer identity across `reload()`. A delivered IPC event is the recovery-readiness proof, and the existing IPC adapters still require the exact sender object, current main frame, allowed origin, and expected document. No ready channel, reload epoch, navigation synchronization, new module, or public API is justified.

Verification must include the committed detached-frame regression, the adjacent IPC trust suites, and the disposable Electron renderer-crash path. The runtime proof must exercise lazy feature loading after recovery and show no `untrusted-sender` or `Could not load app feature` errors.
