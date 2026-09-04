# Trace capture design synthesis

## Base

Candidate 55 is the implementation base because it extends the existing soak command without extracting a one-use transport layer.

## Grafts

- Candidate Sol supplies browser-target-only tracing, an idempotent finish operation, event-wait registration before `Tracing.end`, path-collision validation, aborted-run retention, and the complete cleanup matrix.
- Candidate Terra supplies the `--trace` flag name and a pure retention decision derived from policy, result, and the original run error.

## Rejections

- The page-target fallback is rejected because it does not prove browser, GPU, and utility-process coverage.
- `recordUntilFull` is rejected because an unattended failure investigation needs the latest bounded window.
- A new main-process `contentTracing` IPC capability is rejected because the development-only soak runner already owns a browser CDP boundary.
- Early extraction into separate CDP and trace modules is rejected until a second consumer exists.

## Verification contract

- The existing soak parser and verdict tests remain green.
- Focused tests cover legal trace policies, conflicting paths, failure-only retention, stream closure, byte overflow, and verdict isolation.
- A short Electron run must create a complete trace artifact through the browser CDP target.
