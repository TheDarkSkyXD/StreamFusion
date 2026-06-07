# `react-doctor/alt-text`



- **Category:** Accessibility
- **Severity:** error
- **Source:** oxlint-builtin:jsx-a11y
- **Framework:** global
- **Enabled when:** always (unless customRulesOnly=true)
- **Documentation:** <https://oxc.rs/docs/guide/usage/linter/rules/jsx_a11y/alt-text>

## Validation prompt

Use this to decide whether a fired diagnostic is real or a false positive.

Fires on img, object, area, and input[type='image'] elements lacking an accessible name — img/area need a non-empty alt (or alt='' for purely decorative), object needs inner text or title/aria-label/aria-labelledby, and input[type='image'] needs alt or aria-label/aria-labelledby. False positive: spread props like <img {...props} /> can forward alt invisibly to the static check.

## Fix prompt

Use this once validation confirms the diagnostic is real.

Add a descriptive alt that conveys the image's purpose (alt='Logo of Acme Corp'), or alt='' for purely decorative images — avoid role='presentation' or role='none' since empty alt is preferred. For object/area, use aria-label or descriptive inner text. For input[type='image'], the alt describes the button action. See https://oxc.rs/docs/guide/usage/linter/rules/jsx_a11y/alt-text
