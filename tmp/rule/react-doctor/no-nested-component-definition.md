# `react-doctor/no-nested-component-definition`

Move to a separate file or to module scope above the parent component

- **Category:** Correctness
- **Severity:** error
- **Source:** oxlint-plugin-react-doctor
- **Framework:** global
- **Enabled when:** always

## Validation prompt

Use this to decide whether a fired diagnostic is real or a false positive.

Fires PURELY syntactically: a capitalized-named inner function (/^[A-Z]/) — 'function Foo(){}' or 'const Foo=(...)=>/function' — is lexically nested inside ANY other capitalized function. It does NOT check that the inner returns JSX, that the parent is a real component, or how the inner is used, so most false positives are syntactic. CONFIRM only when ALL hold: the inner genuinely returns JSX, is rendered as a JSX element '<Inner/>' in the parent's returned tree, and the parent is a real component re-running each render — then every render mints a new component identity, so React remounts the subtree, destroying DOM/child state (a controlled '<input>' loses focus) and breaking memoization. SUPPRESS these real FALSE POSITIVES: (a) the inner is not a component — returns a string/number/object/config or feeds a non-React API as a data callback (echarts 'formatter', a comparator, a 'map' projector); (b) the parent is not a component (returns a plain object/config), or the file is a Storybook story ('.stories'/'.story') or test/fixture where transient remounts cost nothing; (c) the inner is INVOKED as a plain function — 'Inner(props)' not '<Inner/>' — React gives it no element identity and never remounts it; (d) the inner is stateless (no hooks, no controlled inputs) AND passed as a prop/render-prop into a subtree already keyed and recreated per item — an intentional 'pass the renderer down' pattern, harmless by design.

## Fix prompt

Use this once validation confirms the diagnostic is real.

Restore a STABLE component identity; don't paper over it. PRINCIPLE: create the component once, not on every parent render. (A) Default fix — hoist to module scope: move the inner above the parent or into its own file; if it used closure values, turn them into props and pass them at the JSX site — lift 'const Colon=()=>(...isLarge...)' to 'function Colon({isLarge,dividerClassName}){...}' rendered as '<Colon isLarge={isLarge} .../>'. This is the only fix that truly removes the bug. (B) If it is NOT really a component — returns a string/object or feeds a non-React API ('formatter', comparator, projector) — keep it inline but rename lowercase ('axisLabelFormatter'); that signals intent and silences the linter. (C) If it is invoked directly ('Inner(props)'), keep it a plain function and rename lowercase, or render it '<Inner/>' and then hoist. ANTI-PATTERN: do NOT 'stabilize' a still-nested component with 'useMemo'/'useCallback'/'React.memo' — they run in the parent scope, still allocate a fresh component each render, and do not stop remounting. See https://react.dev/learn/your-first-component#nesting-and-organizing-components
