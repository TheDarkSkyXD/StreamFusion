# Mobile mockup integration

The mobile application adopts the approved Android layouts through its existing feature controllers. Production and Storybook share presentation components. Remote data, account authorization, persisted settings, playback sessions, and native media work keep their existing owners.

## Architecture decision

Candidate A retains the current controller and route structure. Candidate B introduces a bound screen registry and per-screen presentation models. A is the selected base because the current controllers already protect playback lifecycle, provider authorization, and persistence. A registry migration would add unrelated coordination before the UI changes work.

The [independent cross-judgment](architecture-judgment.md) also selected A. B contributes exact manifest validation and deterministic Storybook adapters for production components. New ports remain feature-owned. Missing native or provider observations cannot use preview values as real results.

## Coverage

`runtime-ledger.json` records the 160 approved story IDs at source commit `8ec1636eda26a4c21d2bab593c7b98ad99df8ab6`. Its initial statuses describe source ownership. They do not establish runtime verification or pixel parity. Stories include component variants and error states, so 160 stories do not mean 160 routes.

`decisions.tsv` records implementation choices and evidence. The screenshots captured before implementation remain immutable. Native system bars and variable provider artwork need explicit comparison regions. Image resizing cannot substitute for matching capture dimensions.

Run the pixel comparison from the repository root:

```powershell
node apps/mobile/scripts/compare-ui-screenshots.mjs pairs.json output-directory
```

Each pair contains `id`, `baseline`, and `actual` paths. Optional `baselineCrop` and `actualCrop` contain Sharp extraction bounds. Optional masks contain integer `left`, `top`, `width`, `height`, and an explicit `reason`. The output includes a diff image and exact changed-pixel counts. A nonzero result requires inspection and does not pass as parity.

The [desktop vocabulary audit](desktop-vocabulary-audit.md) makes desktop labels, icons, and colors authoritative where the mobile host supports the same action. Android sheets and touch targets remain mobile layouts. Host-specific limitations describe actual behavior.

## Delivery checks

Each implementation unit requires focused behavior checks, type checking, and lint. Native contract changes also require a rebuilt Android client. Emulator journeys verify actual entry controls, keyboard and safe areas, playback lifecycle, persisted preferences, and recovery where affected. The emulator is restarted for updated builds and closed whenever device verification is idle.

No production code imports mockup screens, fixtures, or test setup. Unsupported provider actions expose accurate limitations and supported handoffs. Account-only follows cannot use a guest mutation as an Unfollow operation.

The [verification checkpoint](verification-checkpoint.md) records tests, native observations, and their limits. The [implementation evidence](implementation-evidence.json) records owners for the 13 initially missing workflows.
