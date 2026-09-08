# Issue 125 native launcher verification

- Base commit: `6275e1fd3aa6de11abf3cb33171ba09ef1de2e8e`
- Reviewed launcher blob: `fed96044e44d8256a6af86875553a4bde4ddc7ea`
- Environment: warm Android emulator with the existing StreamFusion development client installed; no build, install, or manual development-client selection occurred.
- Invocation: literal root `npm start`, then option `3` (`Mobile (Development Client)`).
- Intent result: the launcher reported the development-client intent open in 6.5 seconds.
- Usable app result: Mobile MCP observed `app-shell-ready` and `development-client-ready` about 25 seconds after option selection. It then observed `Encrypted storage is ready`, SQLCipher `4.7.0 community`, product schema `2`, and cache schema `1`.
- Saved-AVD restart result: after a graceful emulator stop, option `3` started `StreamFusion_Issue_142_API30` and reported the development-client intent open in 11.9 seconds "after cold boot." Mobile MCP observed `app-shell-ready`, `development-client-ready`, and the live native capability profile about 28 seconds after selection. This was a normal saved-AVD restart, not a wiped or no-snapshot OS boot.
- Screenshot: [issue125-development-client-storage-20260908.png](issue-125/issue125-development-client-storage-20260908.png), SHA-256 `3DAAEB255601604906187E4875CFE528A67FC43413E55359B5A11574E527F47D`.
- Scope limits: 6.5 and 11.9 seconds measure intent-open results, not usable-screen readiness. The saved-AVD restart is not evidence of a wiped or no-snapshot OS boot. Package version name/code validation establishes installed client identity and version; it is not a complete native-module fingerprint, so native-module changes still require a rebuild.

The corrected launcher also rejects an Android `am start -W` transcript without `Status: ok`, including the observed exit-zero `Error: Activity not started, unable to resolve Intent` failure, before logging that the client opened.
