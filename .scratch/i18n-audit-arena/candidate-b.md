# Candidate B. Projected native catalog with a typed native UI gateway

## Problem

The renderer already owns the canonical English catalog and lazy-loads one display-language catalog at a time. Main-process Electron UI bypasses that system today. It has literal menu labels, dialogs, notifications, and recovery HTML. A solution must catch those literals without making main import `frontend`, and it must not bundle 50 copies of every renderer key into the main process. The current checks already parse TypeScript and validate exact catalog shape, placeholder names, protected terms, generated loader freshness, and the fixed 50-language registry. This design extends those deterministic checks instead of adding a second translation source or a runtime scanner.

## Usage (caller's view)

The main process creates one gateway after preferences are available. It starts in English so failure recovery works before stored preferences load.

```ts
const nativeUi = createNativeUi({
  electron: electronNativePrimitives,
  language: DEFAULT_DISPLAY_LANGUAGE,
});

await nativeUi.setLanguage(storageService.getPreferences().language);
```

The preference IPC handler is the only language-change caller. It activates the tiny catalog before rebuilding labels that persist in Electron.

```ts
const preferences = storageService.updatePreferences(updates);
await nativeUi.setLanguage(preferences.language);
nativeUi.setApplicationMenu(buildApplicationMenu(nativeUi));
return preferences;
```

Backend-owned copy uses a request. API and user content stays explicit data, never a translation key.

```ts
await nativeUi.messageBox(mainWindow, {
  kind: "question",
  title: native("native.download.chooseClipQuality.title"),
  message: native("native.download.chooseClipQuality.message"),
  buttons: [
    ...qualities.map((quality) => nativeContent(quality.quality)),
    native("native.common.cancel"),
  ],
});

nativeUi.showNotification({
  title: native("native.liveNotification.title", {
    channel: notification.channelDisplayName,
  }),
  body: nativeContent(notification.title),
  silent,
  onClick,
});
```

Recovery does not build prose-bearing HTML in a backend template. It asks the gateway for the complete localized document model and serializes only that model plus the diagnostic data.

```ts
const url = nativeUi.recoveryUrl({
  kind: "startup",
  diagnosticId,
  reopenUrl: appUrl,
});
await recoveryWindow.loadURL(url);
```

The renderer continues to use `t()` and `useTranslation()`. It has no dependency on the native gateway. Renderer-originated IPC notifications remain `nativeContent(title)` and `nativeContent(body)` because the renderer has already resolved them.

## Shape

The public model separates catalog-owned copy from runtime content. `NativeCopyRequest` cannot be mistaken for arbitrary text. `NativeContent` marks data from a channel, platform API, file system, or the renderer. The gateway accepts only this union at an Electron display boundary.

```ts
// src/shared/i18n/native-copy-contract.ts
export const NATIVE_COPY_KEYS = [
  "native.common.cancel",
  "native.menu.view",
  "native.menu.openLogsFolder",
  "native.menu.copyLogPath",
  "native.menu.copyNoiseLogPath",
  "native.menu.copyNetworkLogPath",
  "native.download.chooseClipQuality.title",
  "native.download.chooseClipQuality.message",
  "native.download.saveClip.title",
  "native.recording.chooseQuality.title",
  "native.recording.chooseQuality.message",
  "native.recording.save.title",
  "native.liveNotification.title",
  "native.startupRecovery.title",
  "native.startupRecovery.body",
  "native.startupRecovery.diagnosticUnavailable",
  "native.rendererRecovery.title",
  "native.rendererRecovery.body",
  "native.rendererRecovery.reload",
  "native.rendererRecovery.closeAndReopen",
] as const;

export type NativeCopyKey = (typeof NATIVE_COPY_KEYS)[number];

export type NativeCopyInterpolation = {
  "native.liveNotification.title": { channel: string };
  "native.startupRecovery.body": { diagnosticId: string };
  "native.rendererRecovery.body": { reason: string };
};

type NativeCopyKeyWithValues = keyof NativeCopyInterpolation;
type NativeCopyKeyWithoutValues = Exclude<NativeCopyKey, NativeCopyKeyWithValues>;

export type NativeCopyRequest<K extends NativeCopyKey = NativeCopyKey> = Readonly<{
  source: "catalog";
  key: K;
  values: K extends NativeCopyKeyWithValues ? NativeCopyInterpolation[K] : undefined;
}>;

declare const nativeContentBrand: unique symbol;
export type NativeContent = string & { readonly [nativeContentBrand]: "NativeContent" };
export type NativeDisplayText = NativeCopyRequest | NativeContent;

export function native<K extends NativeCopyKeyWithoutValues>(key: K): NativeCopyRequest<K>;
export function native<K extends NativeCopyKeyWithValues>(
  key: K,
  values: NativeCopyInterpolation[K]
): NativeCopyRequest<K>;

export function nativeContent(value: string): NativeContent;
```

```ts
// src/backend/native-ui/native-copy-resolver.ts
export type NativeCatalog = Readonly<Record<NativeCopyKey, string>>;
export type NativeCatalogLoader = (language: DisplayLanguage) => Promise<NativeCatalog>;

export interface NativeCopyResolver {
  setLanguage(language: DisplayLanguage): Promise<void>;
  text(copy: NativeDisplayText): string;
}

export function createNativeCopyResolver(input: {
  initialLanguage: DisplayLanguage;
  load: NativeCatalogLoader;
  english: NativeCatalog;
}): NativeCopyResolver;
```

`english` is a generated projection and is synchronously available. `setLanguage` serializes activation, loads one non-English native catalog, validates its exact keys before accepting it, and retains the previous catalog if loading fails. `text` performs strict placeholder interpolation. It never calls i18next and never imports the renderer.

```ts
// src/backend/native-ui/native-ui.ts
export interface ElectronNativePrimitives {
  showMessageBox(owner: BrowserWindow, options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue>;
  showSaveDialog(owner: BrowserWindow, options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue>;
  showNotification(options: { title: string; body: string; silent: boolean; onClick(): void }): void;
  setApplicationMenu(template: Electron.MenuItemConstructorOptions[]): void;
}

export interface NativeUi {
  setLanguage(language: DisplayLanguage): Promise<void>;
  label(copy: NativeDisplayText): string;
  messageBox(owner: BrowserWindow, input: NativeMessageBox): Promise<Electron.MessageBoxReturnValue>;
  saveDialog(owner: BrowserWindow, input: NativeSaveDialog): Promise<Electron.SaveDialogReturnValue>;
  showNotification(input: NativeNotification): void;
  recoveryUrl(input: StartupRecovery | RendererRecovery): string;
  setApplicationMenu(items: NativeMenuItem[]): void;
}

export type NativeMenuItem =
  | { readonly role: Electron.MenuItemConstructorOptions["role"] }
  | { readonly type: "separator" }
  | { readonly label: NativeDisplayText; readonly click(): void; readonly submenu?: readonly NativeMenuItem[] };

export type NativeMessageBox = Readonly<{
  kind: "question" | "error" | "info";
  title: NativeDisplayText;
  message: NativeDisplayText;
  buttons: readonly NativeDisplayText[];
  defaultId?: number;
  cancelId?: number;
}>;

export type NativeSaveDialog = Readonly<{
  title: NativeDisplayText;
  defaultPath: string;
  filters: readonly { name: NativeDisplayText; extensions: readonly string[] }[];
}>;
```

The gateway owns conversion to Electron options. Direct uses of `dialog.show*`, `new Notification`, `Menu.buildFromTemplate`, `Menu.setApplicationMenu`, and `data:text/html` recovery documents become forbidden outside `src/backend/native-ui/`. This is the enforcement boundary, not a convenience wrapper. Per boundary-discipline, Electron receives ordinary strings only after the gateway resolves the typed request.

Native English belongs in the existing English catalog under `native`. The key tuple is a small, intentional manifest. A generator projects exactly those values from each of the 50 canonical renderer catalogs.

```ts
// apps/desktop/scripts/lib/i18n-catalog.mjs
export function projectNativeCatalog(
  language: string,
  catalog: unknown,
  keys: readonly string[]
): Record<string, string>;

export function validateCatalogSet(input: {
  english: Catalog;
  catalogs: ReadonlyMap<DisplayLanguage, Catalog>;
  nativeKeys: readonly NativeCopyKey[];
  unchangedEnglishExemptions: ReadonlyMap<string, readonly DisplayLanguage[]>;
}): readonly CatalogIssue[];

export function isUnchangedEnglishProse(english: string, translated: string): boolean;
```

`generate:i18n-catalogs` remains the only writer. It updates the normal generated catalogs, `i18n-source-snapshot.generated.json`, `src/shared/i18n/generated/native-copy.en.ts`, and one `native-copy.<language>.json` per non-English language. Generated main loaders dynamically import only `native-copy.<active-language>.json`. CI runs the same command without `--generate`, so it only compares and validates files.

The catalog validator adds a deterministic `unchanged-english-prose` error. It first strips placeholders and protected values, then fires when the normalized non-English leaf exactly equals an English leaf containing at least two alphabetic words. It ignores URLs, product names, acronyms, and format tokens. A keyed exemption needs a reason and can apply only to named languages. Exact equality is deliberate. It is reproducible and high signal. Heuristic language detection is not accepted as a CI gate.

The existing TypeScript AST renderer scan becomes a shared pure scanner. A second visitor scans backend imports and Electron call shapes. It reports static prose passed directly to the five forbidden native mechanisms, including literals inside recovery HTML. It allows data wrapped by `nativeContent`, values returned from API contracts, Electron role-only menu items, path strings, and logger output. It does not inspect platform payloads as app copy.

## Module map

```text
apps/desktop/src/frontend/i18n/locales/en/*.ts
  Canonical English keys, including native.*. The only authored English copy.

apps/desktop/src/frontend/i18n/locales/{es,generated/*.json}
  Complete renderer catalogs. No native-only authoring location.

apps/desktop/src/shared/i18n/native-copy-contract.ts
  Native key manifest, request/content domain types, and factories.

apps/desktop/src/shared/i18n/generated/native-copy.en.ts
apps/desktop/src/shared/i18n/generated/native-copy-loaders.generated.ts
apps/desktop/src/shared/i18n/generated/native-copy.<language>.json
  Generated narrow catalog projection and one-language lazy loaders.

apps/desktop/src/backend/native-ui/native-copy-resolver.ts
  Pure language activation and interpolation. No Electron import.

apps/desktop/src/backend/native-ui/native-ui.ts
  Electron adapter. The only allowed direct Electron display boundary.

apps/desktop/src/backend/native-ui/recovery-document.ts
  Encodes a localized recovery document model into safe HTML and a data URL.

apps/desktop/scripts/lib/i18n-catalog.mjs
  Shared catalog parse, flatten, validate, and projection functions.

apps/desktop/scripts/lib/i18n-source-audit.mjs
  Pure TypeScript AST scan returning findings for renderer and backend files.

apps/desktop/scripts/check-i18n-catalogs.mjs
  Explicit generation and read-only validation entry point.

apps/desktop/scripts/check-i18n-coverage.mjs
  Read-only renderer and native-boundary audit entry point.
```

## Rationale

The current frontend catalog remains the source of truth. The native projection duplicates bytes only as generated output, never as authored content. A 20-key native catalog loaded on demand is small and keeps Electron main isolated from renderer aliases and React dependencies. A single `NativeUi` surface hides Electron option construction, catalog activation, interpolation, recovery serialization, and menu rebuilding. Callers state only what they want to show.

The wrapper is intentionally stronger than a `t()` helper. A helper would leave every caller responsible for choosing language, resolving values, and avoiding direct Electron literals. The gateway makes those decisions once and gives the AST audit a narrow structural rule to enforce.

## Synthesis decision

Candidate B is an independent arena candidate. The orchestrator selects the base and records any grafts here.

## Tradeoffs accepted

- We accept generated native-catalog files in source control in exchange for a synchronous English startup fallback and no runtime network or renderer import.
- We accept an explicit native key manifest in exchange for keeping main from loading the full renderer catalog.
- We accept exact unchanged-English detection plus reviewed exemptions in exchange for deterministic CI with low false-positive rates.
- We accept rebuilding the app menu after a language change in exchange for Electron-owned labels following the selected display language.
- We accept a narrow gateway migration in exchange for making native UI coverage mechanically auditable.

## Alternatives considered

### Import the renderer catalog into main

This loses process ownership, drags frontend paths and the full catalog graph into main, and makes startup recovery depend on renderer-oriented modules. It exposes bundling and loading policy to every backend caller.

### Put native English and translations in a separate hand-authored catalog

This creates two English sources and invites key drift. It hides no complexity because maintainers must update two catalogs and two completeness mechanisms.

### Keep direct Electron calls and add a broad literal grep

This has a shallow interface. Every caller still decides whether text is copy, API data, or a technical value, while the grep cannot reliably distinguish them. The gateway concentrates that policy.

### Use language detection to reject English-looking translations

Language detection is probabilistic and produces unstable CI failures for short strings, product names, and related languages. Exact unchanged-prose detection is narrower but deterministic.

## Open questions and risks

- Which existing English catalog namespace should own `native`? A separate top-level namespace makes the projection obvious, but it adds one catalog module.
- Should notification titles produced in the renderer cross IPC as `NativeContent`, or should live notifications move fully behind the main gateway first? The latter gives one owner but changes a working renderer flow.
- Do macOS Electron role menus need explicit labels at all? Keeping role items role-only lets Electron use the operating-system localization.
- The native HTML recovery document must escape diagnostic and URL data after copy resolution. The encoder needs focused XSS tests even though the document has a restrictive CSP.
- Exact equality catches unchanged source prose, not a partially translated sentence. Review remains necessary for translation quality.

## Test plan

All tests run under Node with injected fakes. None boot Electron or call the network.

```ts
describe("native catalog projection", () => {
  it("projects exactly NATIVE_COPY_KEYS from all 50 validated catalogs");
  it("fails a missing native key, an extra key, changed placeholder, or stale generated file");
  it("flags unchanged English prose in a non-English catalog and permits only a keyed exemption");
});

describe("native copy resolver", () => {
  it("uses synchronous English before any lazy load");
  it("loads only the requested language and serializes repeated language changes");
  it("keeps the prior catalog when a lazy loader fails");
  it("interpolates exactly the declared values");
});

describe("native UI gateway", () => {
  it("converts CopyRequest and NativeContent into Electron options through a fake port");
  it("rebuilds localized menu labels after setLanguage");
  it("escapes diagnostic data in the recovery data URL");
});

describe("source audit", () => {
  it("rejects renderer JSX, visible attributes, toasts, and presentation props with static prose");
  it("rejects direct dialog, notification, menu, BrowserWindow title, and recovery-HTML prose");
  it("allows Electron roles, API payload fields, log messages, paths, URLs, test fixtures, and nativeContent data");
});
```

CI runs `check:i18n-catalogs` and `check:i18n-coverage` without generation. A maintainer runs `generate:i18n-catalogs` deliberately, reviews the catalog and projection diff, then commits it.

## Next implementation step

Extract the pure catalog parse, validation, projection, and source-audit functions from the two existing scripts before adding the native key manifest or moving Electron call sites.
