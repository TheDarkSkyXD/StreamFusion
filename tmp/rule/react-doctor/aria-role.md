# `react-doctor/aria-role`

Use a documented, non-abstract WAI-ARIA role for every role attribute.

- **Category:** Accessibility
- **Severity:** error
- **Source:** oxlint-plugin-react-doctor
- **Framework:** global
- **Enabled when:** always
- **Documentation:** <https://oxc.rs/docs/guide/usage/linter/rules/jsx_a11y/aria-role>

## Validation prompt

Use this to decide whether a fired diagnostic is real or a false positive.

Fires on any JSX element carrying a `role` prop (case-insensitive name) when the value is bare (`<div role />`), null/undefined, an empty or whitespace-only string, or a space-separated list where any token is not an exact-case match in the WAI-ARIA role set (so `role='Button'` and `role='datepicker'` fail while `role='button'` and `role='tabpanel row'` pass). Custom-element names are still checked unless `ignoreNonDOM` is enabled, and unknown tokens can be whitelisted via `allowedInvalidRoles`. False positive: dynamic expressions are assumed valid and never flagged (`role={role}`, `role={role || 'button'}`), so a runtime value that resolves to a bad role slips through — only static literals are validated.

## Fix prompt

Use this once validation confirms the diagnostic is real.

Replace the role with a documented, non-abstract WAI-ARIA role spelled in exact lowercase (`role='button'`, not `role='Button'`); for multi-role values every space-separated token must be valid (`role='tabpanel row'`). Drop empty, bare, or null roles entirely rather than leaving `role=''` or `role={null}` — omitting the attribute is correct when no role applies. If you intentionally use a non-standard role (e.g. a framework extension), add it to the rule's `allowedInvalidRoles` setting instead of disabling the rule. See https://oxc.rs/docs/guide/usage/linter/rules/jsx_a11y/aria-role
