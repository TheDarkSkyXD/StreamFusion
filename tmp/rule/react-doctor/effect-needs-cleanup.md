# `react-doctor/effect-needs-cleanup`

Return a cleanup function that releases the subscription / timer: `return () => target.removeEventListener(name, handler)` for listeners, `return () => clearInterval(id)` / `clearTimeout(id)` for timers, or `return unsubscribe` if the subscribe call already returned one

- **Category:** State & Effects
- **Severity:** error
- **Source:** oxlint-plugin-react-doctor
- **Framework:** global
- **Enabled when:** always

## Validation prompt

Use this to decide whether a fired diagnostic is real or a false positive.

Fires on useEffect/useLayoutEffect whose callback contains a timer ('setInterval'/'setTimeout' as a bare-identifier call) or a subscription member call ('.subscribe'/'.addEventListener'/'.addListener'/'.on'/'.watch'/'.listen'/'.sub') with NO returned cleanup that releases it. Note the detector descends into EVERY nested function to find the registration, but its cleanup matcher mostly looks at the effect's top-level statements and returned function — this asymmetry causes the two real false positives. SUPPRESS when (1) the timer/subscription is NOT scheduled synchronously by the effect's own mount/re-run body but sits inside a callback the effect merely DEFINES and hands off — stored via a setState ('setOptions(opts)' where 'opts[].apply' closes over 'setTimeout'), returned in a CodeMirror/config options object, or a click/keydown handler closure — so the timer only runs on a later user/event tick and the effect owns no live resource to clean. (2) a returned cleanup DOES release this resource even if the matcher missed it: a local helper like 'const clearDisposeTimer = () => clearTimeout(id)' invoked from the returned teardown, or the timer is set inside an observer/subscription callback whose 'return () => stop()' tears the whole thing down. CONFIRM when the effect body itself fires 'setTimeout(fn, ms)'/'.addEventListener'/'api.on(...)' on mount and returns nothing — even a 'setTimeout(..., 0)' or hash-scroll one-shot is a true leak (re-run/unmount can fire stale callbacks or stack duplicate listeners). A registration is intended-to-outlive only when explicitly handed to a persistent external owner, not merely because it is short.

## Fix prompt

Use this once validation confirms the diagnostic is real.

Principle: release exactly what the effect registers, on the same lifecycle that registered it — never just paper over the warning. (A) Timers run synchronously in the body: capture the id and clear it — 'const id = setTimeout(() => setActionClicked(showMenu), 0); return () => clearTimeout(id)' (use clearInterval for setInterval). This is the right fix even for 0ms/one-shot timers, since a fast re-run or unmount must cancel the pending tick. (B) DOM/emitter listeners: hoist the handler to a named const and remove the same reference — 'const onAppInstalled = () => {...}; window.addEventListener("appinstalled", onAppInstalled); return () => window.removeEventListener("appinstalled", onAppInstalled)'; for 'api.on("select", cb)' return 'api.off("select", cb)'. (C) subscribe-returning APIs: 'const sub = source.subscribe(cb); return () => sub.unsubscribe()', or 'return channel.unsubscribe()'/'return sub' directly when the call already yields an unsubscribe handle. (D) Resource set inside an observer/async callback: keep a mutable id and clear it from one returned teardown — 'let timer = null; ...timer = setTimeout(...); return () => { if (timer) clearTimeout(timer); stop(); }'. Anti-patterns: do NOT delete the timer/listener to silence the rule, do NOT add an empty 'return () => {}', and do NOT move a registration that is merely DEFINED-and-handed-off (a setTimeout living inside a state-stored 'apply' callback or an event handler) — that callback is not effect-owned, so the fix is to suppress, not to wrap it. See https://react.dev/reference/react/useEffect#parameters
