# Windows taskbar icon diagnosis and fix

Native evidence before changes: PID 67684, visible HWND 71552. WM_GETICON returned valid small and large StreamFusion logos (window-71552-icon-0.png and -1.png). Checked-in ICO path resolved correctly, so replacing artwork would not address the defect. Windows Shell property store returned VT_EMPTY for System.AppUserModel.ID and RelaunchIconResource (taskbar-properties-before.json). Root visually confirmed the taskbar button displayed the Electron atom; it disappeared when this isolated preview closed.

Root cause in app-identity.ts: both configureAppIdentity and configureWindowIdentity skipped explicit taskbar identity for unpackaged processes. electron-vite preview remains unpackaged, so correct BrowserWindow icons coexisted with the host Electron taskbar identity. Existing tests asserted that omission and have now been corrected.

Changes:
- All Windows launches get the stable com.streamfusion.app process and window identity.
- Development/preview relaunch icon points to the existing real ICO file.
- Packaged relaunch icon points to process.execPath, whose icon electron-builder embeds from assets/icons/icon. Windows Shell cannot load an icon through Electron's virtual app.asar filesystem. BrowserWindow still gets the ICO as before.
- No icon generation, shortcut creation, pin changes, registry edits, account changes, or renderer changes.

Files: src/backend/features/shell/domain/app-identity.ts; src/backend/window-manager.ts; src/backend/features/shell/tests/app-identity.test.ts (all under apps/desktop).

Verification so far: taskbar-identity-red.log records 3 failed/4 passed before fix. After fix, identity + window-manager suites 12 tests passed; desktop tsc --noEmit and scoped ESLint passed. Package configuration still uses build.appId=com.streamfusion.app and build.icon=assets/icons/icon; no package config mutation needed. Installed executable resource behavior is covered by wiring/config regression, not a newly packaged installer run.

Primary references:
- https://www.electronjs.org/docs/latest/api/browser-window#winsetappdetailsoptions-windows
- https://learn.microsoft.com/en-us/windows/win32/properties/props-system-appusermodel-relaunchiconresource
- https://learn.microsoft.com/en-us/windows/win32/properties/props-system-appusermodel-relaunchcommand

An explicit per-window ID is required for the relaunch icon. Relaunch command and display name are a pair if supplied; this fix does not change their behavior. Native post-rebuild Shell properties and an actual taskbar screenshot are still required before declaring visual completion.

## Completed runtime proof

Rebuilt compiled preview PID 84836 / visible HWND 923866: read-only Windows property store now reports `System.AppUserModel.ID=com.streamfusion.app` and `RelaunchIconResource=<repo>\apps\desktop\assets\icons\icon.ico,0`. Native small and large window icon handles remain valid. Evidence: `taskbar-native-after.json`, `taskbar-properties-after.json`. Relaunch command/display name remain unset; no shortcut or pin changes were made.

Parent verified actual Windows taskbar screenshot `taskbar-fixed.png`: StreamFusion green/purple logo replaces the Electron atom. Doctor healthy. This proves the unpackaged compiled preview case; packaged executable resource wiring is covered by tests/configuration, without claiming installer runtime verification.

Merged the duplicate Windows guard without changing behavior. Final scoped Vitest command passed 2 files / 12 tests at 20:04:45 local; scoped ESLint passed. Desktop TypeScript check had passed before this guard-only cleanup. Source frozen for parent final hooks/rebuild.
