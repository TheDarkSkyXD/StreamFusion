# `react-doctor/no-eval`

Use `JSON.parse` for serialized data, `Function(...)` (still careful) for trusted templates, or refactor to avoid dynamic code execution

- **Category:** Security
- **Severity:** error
- **Source:** oxlint-plugin-react-doctor
- **Framework:** global
- **Enabled when:** always

## Validation prompt

Use this to decide whether a fired diagnostic is real or a false positive.

Confirm one of three AST shapes: a bare eval(...) Identifier call, a new Function(...) NewExpression, or setTimeout / setInterval whose first argument is a string literal (the rule does not flag function-valued first arguments). True positives are almost always real code-injection or CSP-violating risks.

## Fix prompt

Use this once validation confirms the diagnostic is real.

Parse data with JSON.parse, replace string-arg timers with arrow functions (setTimeout(() => doThing(), 100) instead of setTimeout("doThing()", 100)), and refactor templated code generation into a pre-compiled function or lookup table. If dynamic evaluation is truly required, sandbox it in a Web Worker or a strict Trusted Types CSP context. See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval#never_use_eval!
