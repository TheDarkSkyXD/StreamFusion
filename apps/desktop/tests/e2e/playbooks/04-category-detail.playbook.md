# Category Detail page playbook

## Goal
Confirm clicking into a specific category mounts the detail page with a back-link and either streams grid or empty state.

## Steps

1. **Navigate to Categories first**
   ```js
   window.location.hash = "/categories";
   ```

2. **Click the first category card**
   - Wait until at least one card is rendered:
     ```js
     !!document.querySelector('a[href*="/categories/"][href*="/"]')
     ```
   - Then click:
     ```js
     document.querySelector('a[href*="/categories/"][href*="/"]').click();
     ```

3. **Verify the detail page mounted**
   ```js
   document.body.innerText.includes("Back to Categories")
   ```

4. **Verify either streams or a clear empty message**
   ```js
   const t = document.body.innerText;
   t.includes("No active streams") || !!document.querySelector('[data-testid*="stream"], .stream-card, h1')
   ```

5. **Screenshot** → `category-detail.png`.

## Pass criteria
- [ ] URL hash matches `#/categories/<platform>/<id>`.
- [ ] "Back to Categories" link visible.
- [ ] Either streams grid or empty state present.
