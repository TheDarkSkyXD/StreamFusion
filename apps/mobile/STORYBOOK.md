# Review Android screens and components

From the repository root, start the catalog:

```powershell
npm run --workspace @streamfusion/mobile storybook
```

Open [mobile Storybook](http://127.0.0.1:6007). The default viewport is a 412 by 892 Android phone. The viewport toolbar also offers a compact phone and tablet. Resize above 599 dp for the navigation rail, and above 840 dp for Watch's video and chat layout.

The Android sidebar has three groups:

- Components contains existing and new reusable controls, states, and feature card mockups.
- Screens contains mockups for current mobile destinations and Settings sections.
- Proposed contains desktop workflows that do not yet have complete mobile capabilities.

Every screen uses local fixtures. Controls update local presentation state. Chat messages, moderation actions, votes, predictions, downloads, account connections, and model installation never reach a provider or native service. Mockups do not start the production composition root. Stream art and emote art are placeholders.

Build and verify the catalog:

```powershell
npm run --workspace @streamfusion/mobile build-storybook
npm run --workspace @streamfusion/mobile verify:storybook
```

The static build is in `apps/mobile/dist/storybook`. The verifier checks built story IDs against both apps' route registries, mobile Settings categories, shared presentation files, and exported shared components. Representative states have separate stories; the verifier does not infer every possible component state.

The preview self-hosts Inter 4.1 from the upstream [Inter project](https://github.com/rsms/inter/tree/v4.1/docs/font-files). Its SIL Open Font License is retained under `.storybook/public/fonts/`.

To repeat browser render and accessibility checks, open a story's iframe, such as [Home](http://127.0.0.1:6007/iframe.html?id=android-screens-discovery--home&viewMode=story). Wait for the accessibility addon to load. Run this in that iframe's browser console:

```javascript
const { auditStories } = await import("/browser-audit.js");
const report = await auditStories();
console.table(report.failures);
```

The audit renders each indexed story and checks WCAG A and AA rules using the Storybook accessibility addon. It reports render failures, empty content, and accessibility violations. It does not check TalkBack, Android Back, keyboard resize behavior, system PiP, native gestures, or playback capacity. Those require a device or emulator.

The [comparison and Android research](../../docs/research/streamfusion-mobile/android-components.md) explains the missing outcomes and mobile adaptations. The [coverage map](src/features/design-preview/domain/story-coverage.ts) identifies the story for every route and Settings section.
