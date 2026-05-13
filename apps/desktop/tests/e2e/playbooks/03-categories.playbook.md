# Categories page playbook

## Goal
Confirm Categories page loads categories from the unified backend, the heading + filter input render, and filtering works.

## Steps

1. **Navigate**
   ```js
   window.location.hash = "/categories";
   ```

2. **Wait for the grid (or loading skeleton) to mount**
   ```js
   document.body.innerText.includes("Categories") && !!document.querySelector('input[placeholder*="Filter categories"]')
   ```

3. **Type a guaranteed-miss query**
   ```js
   const i = document.querySelector('input[placeholder*="Filter categories"]');
   const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
   setter.call(i, "zzz-categories-miss");
   i.dispatchEvent(new Event("input", { bubbles: true }));
   ```

4. **Assert the typed-empty state**
   ```js
   document.body.innerText.includes('No categories matching "zzz-categories-miss"')
   ```

5. **Screenshot** → `categories.png`.

## Pass criteria
- [ ] Heading "Categories" present.
- [ ] Filter input present.
- [ ] Typing a no-match query shows the typed-empty message.
