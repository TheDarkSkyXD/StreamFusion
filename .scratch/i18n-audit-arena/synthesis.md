# Localization audit design synthesis

## Pick

Use Candidate A's synchronous shared projection as the base, but replace its recursive schema with Candidate B's flat key manifest. Generate one bounded map that contains only native keys for all 50 languages.

The cross-judge selected Candidate B because lazy loading guarantees a small main bundle. I rejected its full gateway because the async language state, branded content escape, and Electron wrapper add more lifecycle code than this copy set needs. A hard native-key budget gives the synchronous projection the same size protection and keeps startup recovery available before the renderer or storage exists.

## Grafts

- Use Candidate B's explicit native key manifest and source audit targets.
- Use Candidate A's native-key budget and one read-only localization check.
- Add the judge's indirect-error rule for user-visible `Error.message` paths.
- Keep Electron role-only menu items on Electron's operating-system translations. Translate every custom menu label.

## Rejections

- Do not import the full frontend catalog into the main process.
- Do not add an async native catalog loader for fewer than 24 bounded keys.
- Do not expose `nativeContent(string)`. Runtime platform content remains plain data at existing typed call sites.
- Do not create a broad `NativeUi` wrapper. The audit can forbid literals at the existing Electron sinks without moving Electron ownership.

## Verification

The selected design must pass a fixture-backed native-copy test, fail on raw Electron copy, fail on unchanged English prose, and keep the generated native projection under its key budget.
