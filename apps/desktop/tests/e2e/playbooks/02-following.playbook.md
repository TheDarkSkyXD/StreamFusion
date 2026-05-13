# Following page playbook

## Goal
Confirm the Following page renders heading, platform filters, search input, and the right empty state — or live channels when signed in.

## Preconditions
- Dev build running with MCP.
- Optional: user is signed into Twitch and/or Kick. The playbook works either way; the empty-state assertion only fires when no follows exist.

## Steps

1. **Navigate to Following**
   ```js
   window.location.hash = "/following";
   ```

2. **Verify heading and chrome**
   ```js
   const headings = Array.from(document.querySelectorAll("h1"));
   ({ hasHeading: headings.some(h => /following/i.test(h.textContent)) })
   ```

3. **Verify filter buttons**
   ```js
   const txt = document.body.innerText;
   ({ all: txt.includes("All"), tw: /twitch/i.test(txt), kk: /kick/i.test(txt) })
   ```

4. **Type into search and assert empty-on-miss**
   ```js
   const i = document.querySelector('input[placeholder*="Search followed channels"]');
   i.focus();
   // Use native value setter so React state updates.
   const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
   setter.call(i, "zzz-no-match-12345");
   i.dispatchEvent(new Event("input", { bubbles: true }));
   ```
   Wait ~300ms, then:
   ```js
   document.body.innerText.includes('No matches for "zzz-no-match-12345"')
   ```

5. **Screenshot** → `following.png`.

## Pass criteria
- [ ] `h1` "Following" present.
- [ ] All / Twitch / Kick filter buttons present.
- [ ] Search input filters list and shows the typed-query empty message.
