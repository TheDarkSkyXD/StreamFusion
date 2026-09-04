# Candidate A. A shared native-copy bundle with one deterministic audit

## Problem

The renderer owns a complete, lazy-loaded `i18next` catalog. The main process cannot import that code without breaking the Electron process boundary or pulling 2,234 keys across 50 languages into the main bundle. Yet the main process already renders user-facing text through notifications, dialogs, menus, save dialogs, and startup recovery HTML. The current checks prove catalog structure and renderer literals, but do not cover those native presentation sinks or flag copied English prose in a non-English catalog.

This design keeps the full English renderer catalog as the source of truth. It adds a deliberately small shared native-copy projection, generated from that catalog, and makes one read-only audit own completeness, native-copy parity, and presentation-text scans.

## Usage

### Renderer caller

```tsx
const { t } = useTranslation();

return <Button aria-label={t("settings.displayLanguage")}>{t("common.save")}</Button>;
```

Renderer callers keep using `react-i18next`. They do not import the native-copy bundle.

### Main-process notification caller

```ts
const copy = nativeCopyFor(storageService.getPreferences().language);

new Notification({
  title: copy.text("liveNotification.title", { channelName: notification.channelDisplayName }),
  body: notification.title,
  icon: appIconPath,
  silent: options.silent,
}).show();
```

### Startup recovery caller

```ts
const copy = nativeCopyFor(preferences.language);
const document = buildStartupRecoveryDocument(copy, diagnosticId);

void recoveryWindow.loadURL(document.dataUrl).catch(() => {
  dialog.showErrorBox(document.fallbackTitle, document.fallbackDetail);
});
```

### Context-menu caller

```ts
const copy = nativeCopyFor(storageService.getPreferences().language);
const template = buildContextMenuTemplate(params, copy);
Menu.buildFromTemplate(template).popup({ window });
```

## Shape

### Shared native-copy contract

`src/shared/i18n/native-copy-schema.ts` owns the small vocabulary, interpolation contract, and maximum bundle size. It does not contain translations.

```ts
export const NATIVE_COPY_SCHEMA = {
  contextMenu: {
    copy: [],
    paste: [],
  },
  liveNotification: {
    title: ["channelName"],
  },
  startupRecovery: {
    windowTitle: [],
    heading: [],
    description: [],
    diagnosticId: ["diagnosticId"],
    unavailableDiagnosticId: [],
    fallbackTitle: [],
    fallbackDetail: ["diagnosticId"],
  },
  downloadSave: {
    title: [],
    videoFilterName: [],
  },
} as const;

export type NativeCopyKey = LeafPath<typeof NATIVE_COPY_SCHEMA>;
export type NativeCopyArguments<Key extends NativeCopyKey> =
  Record<SchemaVariables<typeof NATIVE_COPY_SCHEMA, Key>[number], string | number>;

export type NativeCopyCatalog = CatalogFor<typeof NATIVE_COPY_SCHEMA>;

export interface NativeCopy {
  readonly language: DisplayLanguage;
  text<Key extends NativeCopyKey>(
    key: Key,
    values: NativeCopyArguments<Key>
  ): string;
}
```

`LeafPath`, `SchemaVariables`, and `CatalogFor` are private recursive type helpers. The public surface is one resolver and one `text` method. The key schema is the only place that declares a native key or its placeholders.

`src/shared/i18n/native-copy.ts` owns the English values and the pure resolver.

```ts
export const nativeCopyEn = {
  contextMenu: { copy: "Copy", paste: "Paste" },
  liveNotification: { title: "{{channelName}} is live" },
  startupRecovery: {
    windowTitle: "StreamFusion recovery",
    heading: "StreamFusion couldn't start safely",
    description:
      "Your saved data was not removed. Close and reopen the app. If this happens again, include the diagnostic ID below with a bug report.",
    diagnosticId: "Diagnostic ID: {{diagnosticId}}",
    unavailableDiagnosticId: "Diagnostic ID unavailable",
    fallbackTitle: "StreamFusion couldn't start safely",
    fallbackDetail:
      "Your saved data was not removed. Restart the app and include diagnostic ID {{diagnosticId}} if this repeats.",
  },
  downloadSave: { title: "Save video", videoFilterName: "MP4 Video" },
} as const satisfies NativeCopyCatalog;

export function nativeCopyFor(language: unknown): NativeCopy {
  throw new Error("not implemented");
}
```

`nativeCopyFor` calls `resolveDisplayLanguage`, selects the matching generated native projection, falls back to English only when the projection is absent, and formats `{{name}}` placeholders. It rejects unexpected interpolation values in development and never reads storage or Electron. Its input is `unknown` so each process can pass persisted preferences directly at its own boundary.

`src/shared/i18n/native-copy.generated.ts` contains only `Record<Exclude<DisplayLanguage, "en">, NativeCopyCatalog>`. It is generated from the full renderer catalogs. English remains in `native-copy.ts`. At the proposed 12 keys, the shared boundary carries 600 localized strings, not 111,700 full-catalog strings. The audit makes the numeric cap explicit, for example `NATIVE_COPY_KEY_LIMIT = 24`.

The frontend English catalog imports the English native object into its complete catalog.

```ts
import { nativeCopyEn } from "@shared/i18n/native-copy";

export const en = {
  native: nativeCopyEn,
} as const;
```

Spanish adds `locales/es/native.ts`. The existing generator produces `native` for the other 48 languages. This makes native values ordinary catalog values. The full 50-language parity rule still applies to every key.

### Native UI builders

Native UI builders receive a `NativeCopy`, never a language code, a renderer translator, or raw user-facing string.

```ts
export function buildContextMenuTemplate(
  params: Pick<ContextMenuParams, "selectionText" | "isEditable">,
  copy: NativeCopy
): MenuItemConstructorOptions[];

export function buildStartupRecoveryDocument(
  copy: NativeCopy,
  diagnosticId: string
): {
  dataUrl: string;
  fallbackTitle: string;
  fallbackDetail: string;
};

export function buildLiveNotificationOptions(
  copy: NativeCopy,
  input: Pick<LiveNotificationPayload, "channelDisplayName" | "title">,
  options: { silent: boolean; icon: string }
): NotificationOptions;
```

`buildStartupRecoveryDocument` HTML-escapes both formatted copy and the diagnostic identifier before interpolating them into the data URL. It remains a pure function. The Electron calls stay in the existing wrapper modules. The builders own presentation decisions, so no pass-through service is introduced.

### Deterministic audit and explicit generation

`scripts/i18n/catalog-model.mjs` is a Node-only parser and validator. It loads authored English and Spanish modules, generated JSON, the shared native schema, and generated native projection. Its public functions return findings and never write.

```ts
export function readCatalogSet(root: string): Promise<CatalogSet>;
export function validateCatalogSet(set: CatalogSet): LocalizationFinding[];
export function validateNativeProjection(set: CatalogSet): LocalizationFinding[];
export function findUntranslatedEnglishProse(set: CatalogSet): LocalizationFinding[];
```

`scripts/check-localization.mjs` calls those functions plus an AST scanner. CI runs one read-only command.

```json
{
  "scripts": {
    "check:localization": "node scripts/check-localization.mjs",
    "generate:i18n-catalogs": "node scripts/generate-i18n-catalogs.mjs"
  }
}
```

`check:localization` fails when any of these holds.

- The display registry is not exactly 50 unique languages.
- English, Spanish, any generated renderer catalog, or the native projection has missing, extra, empty, or interpolation-incompatible keys.
- A generated file, source snapshot, catalog loader, or native projection differs from its deterministic expected form.
- A non-English value is verbatim English prose after placeholders and protected product terms are removed. The rule requires two or more ASCII words and an English function word. It has a narrow keyed allowlist with a required reason for intentional English text.
- Renderer JSX text, visible attributes, presentation props, and visible notification calls contain raw text outside catalog modules and explicitly approved technical literals.
- Native presentation sinks contain raw prose. The AST scanner covers Electron `dialog` titles, messages, details, buttons and filters, `Notification` title and body, `MenuItemConstructorOptions.label`, and `data:text/html` startup content. It allows values returned by `NativeCopy.text`, known pure native builders, product names, and test fixtures only.

`generate:i18n-catalogs` is the only mutating command. It may call the existing translator, updates generated renderer catalogs, the snapshot, loader, and `native-copy.generated.ts`, then invokes `check:localization`. CI never passes a `--generate` flag.

### Tests

```ts
describe("nativeCopyFor", () => {
  it("uses the selected language and normalizes aliases without Electron", () => {});
  it("formats only schema-declared placeholders", () => {});
  it("falls back to English if a generated native projection is absent", () => {});
});

describe("startup recovery document", () => {
  it("escapes the diagnostic ID and uses translated recovery copy", () => {});
});

describe("localization audit", () => {
  it("rejects raw Notification title text", () => {});
  it("rejects an unchanged English sentence in Spanish", () => {});
  it("accepts a protected product name and a typed native-copy lookup", () => {});
});
```

These tests import pure functions and fixture catalogs. They need neither Electron nor network access. The generator receives a fake translator in its own unit test. The check command never invokes a translator.

## Module map

| Module | Ownership |
| --- | --- |
| `src/shared/i18n/native-copy-schema.ts` | Native key and placeholder schema, plus the bundle budget. |
| `src/shared/i18n/native-copy.ts` | English native values and pure resolver. |
| `src/shared/i18n/native-copy.generated.ts` | Generated all-language native projection. |
| `src/frontend/i18n/locales/en.ts` | Merges shared English native values into the renderer source catalog. |
| `src/frontend/i18n/locales/es/native.ts` | Authored Spanish native values. |
| `src/backend/context-menu.ts` | Builds typed native menu labels. |
| `src/backend/startup/startup-recovery-window.ts` | Uses the pure recovery document builder and keeps Electron lifecycle work. |
| `src/backend/services/live-notification-service.ts` | Uses typed native notification title copy. |
| `src/backend/services/download-save-dialog.ts` | Resolves native dialog title and filter text from the small copy bundle. |
| `scripts/i18n/catalog-model.mjs` | Read-only catalog and projection model. |
| `scripts/check-localization.mjs` | One deterministic catalog and source audit entry point. |
| `scripts/generate-i18n-catalogs.mjs` | Explicit network-capable generation and projection emission. |
| `tests/shared/native-copy.test.ts` | Resolver and interpolation tests. |
| `tests/backend/startup-recovery-document.test.ts` | Pure HTML-builder tests. |
| `tests/scripts/check-localization.test.ts` | Fixture-based scanner and prose-rule tests. |

## Rationale

The shared native projection is the boundary. The main process gets a small, synchronous, typed resolver and cannot depend on renderer modules. The renderer keeps one complete English catalog and lazy loads the existing full locale chunks. Generation derives the native projection from those same catalogs, so no second set of translations drifts by hand.

The catalog model groups completeness, projection, and prose rules around the catalog data they protect. The AST scanner groups renderer and native sink policy in the same audit entry point because a failed user-facing string is one class of defect. This avoids temporal modules named load, transform, and validate that repeat the catalog representation.

The interface is intentionally narrow. Main-process callers ask for one typed string. They do not manage locale fallback, JSON imports, interpolation, or catalog shape. Per boundary discipline, persisted language values normalize at `nativeCopyFor`, and builders receive trusted copy. Per type-system discipline, a caller cannot pass a value to a key that does not declare that placeholder.

## Synthesis decision

Candidate A only. Arena synthesis has not selected a base or made grafts.

## Tradeoffs accepted

- We accept a generated shared subset of every locale in exchange for synchronous main-process native text without importing frontend code.
- We accept a fixed native-copy key budget in exchange for preventing the main bundle from quietly becoming a second full catalog loader.
- We accept a conservative English-prose heuristic and a reviewed keyed allowlist in exchange for deterministic checks with no language-detection service or network dependency.
- We accept explicit migration of known native text sinks in exchange for an audit rule that can make future raw literals fail CI.

## Alternatives considered

- Load full renderer catalogs from the backend. It loses the process boundary and exposes the main process to renderer ownership and all 111,700 strings.
- Give every native UI call an IPC request to the renderer translator. It exposes availability, timing, and renderer lifecycle concerns to startup recovery and menu callers. It also cannot work before the renderer exists.
- Keep separate manually maintained backend translations. It gives callers a simple lookup but creates a second source of truth and duplicate parity work.
- Use a general `translate(locale, key)` service backed by all catalogs. It appears flexible but exposes the entire renderer keyspace and permits native callers to grow the main bundle without a boundary.

## Open questions and risks

- Which current native surfaces are product copy and which should keep Electron's OS-localized role labels? The migration list should exclude role-only items with no app-defined text.
- Is machine translation acceptable for the native projection, or should the release process require review for the small native subset before publishing?
- Does the product want startup recovery to follow the saved display language when preferences may be corrupted? Candidate A safely falls back to English, but product policy should decide whether that is preferable to system locale.
- The English-prose heuristic catches copied sentences. It cannot prove that every short English word is untranslated without false positives. The audit should report rather than fail on single-word candidates until the allowlist proves stable.

## Next implementation step

Add the shared native-copy schema and English values, merge `native` into the English catalog, then make the existing catalog checker validate that one new namespace before migrating any Electron callers.
