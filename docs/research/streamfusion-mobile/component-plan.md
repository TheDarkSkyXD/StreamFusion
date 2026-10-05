# Android component and screen catalog

## Completion criteria

Every registered mobile and desktop route has an Android mockup in Storybook. Shared components have stories and representative states. The browser catalog builds, mobile type checking and lint pass, and sheet, dialog, navigation, and form interactions work in the running catalog. Mockups use local fixtures and cannot initialize account, storage, playback, or provider services.

## Workflow

- [x] Read the Principles section of the SuperDev mode skill.
- [x] Phase A. Frame the work and define completion criteria.
- [x] Phase B. Design the workflow and compare integration shapes.
- [x] Phase C. Run the loop.
- [x] Inventory desktop and mobile destinations and components against source files.
- [x] Research official Android component guidance and Storybook integration.
- [x] Add an isolated Storybook entry and verify a shared component renders.
- [x] Add reusable mobile presentation components and component stories.
- [x] Add screen mockups and capability-specific states.
- [x] Phase D. Keep the audit trail.
- [x] Phase E. Verify and hand back.
- [x] Review the diff and prepare task-only files for a direct-main commit and push.

## Scope and verification

The catalog covers discovery, follows, playback, chat, media, activity, accounts, settings, support, and desktop-only workflows. The source inventory determines the final screen count. The first checkpoint is a running React Native component in browser Storybook. This tests package resolution before building the catalog.

The design follows DESIGN.md and existing mobile tokens. Android interaction patterns use 48 dp targets, safe areas, hardware Back dismissal, keyboard avoidance, scrollable sheets, and adaptive layouts. Browser previews prove layout and local interactions. Android-only platform behavior requires a device or emulator and is reported separately.

Existing changes under `.agents/` belong to the user and remain outside this commit. The user requested commits directly to main and no pull request.
