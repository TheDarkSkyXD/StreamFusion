# Search Results page playbook

## Goal
Confirm typing in the top-bar search and pressing Enter navigates to `/search?q=...` and mounts the results UI.

## Steps

1. **Navigate to Home** so the top bar is visible:
   ```js
   window.location.hash = "/";
   ```

2. **Type into the global search**
   ```js
   const input = document.querySelector('input[placeholder*="Search streams"], input[type="search"]');
   const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
   setter.call(input, "ninja");
   input.dispatchEvent(new Event("input", { bubbles: true }));
   input.focus();
   input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
   ```

3. **Verify hash includes `/search` and `q=ninja`**
   ```js
   window.location.hash.includes("/search") && window.location.hash.includes("q=ninja")
   ```

4. **Wait for some result chrome (tab labels, "Channels", etc.)**
   ```js
   /channels|streams|videos|clips|categories/i.test(document.body.innerText)
   ```

5. **Screenshot** → `search-results.png`.

## Pass criteria
- [ ] URL hash navigated to `/search?q=ninja`.
- [ ] Search result UI (any of the tab labels) renders.
