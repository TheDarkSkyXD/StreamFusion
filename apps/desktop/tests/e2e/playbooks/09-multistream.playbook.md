# MultiStream page playbook

## Goal
Confirm MultiStream toolbar renders, the focus-layout button is disabled when empty, and adding a stream via the dialog populates the grid.

## Steps

1. **Navigate**
   ```js
   window.location.hash = "/multistream";
   ```

2. **Verify toolbar**
   ```js
   document.body.innerText.includes("MultiStream")
   ```

3. **Verify focus button disabled with 0 streams**
   ```js
   const focus = document.querySelector('[title="Focus Layout"]');
   focus?.disabled === true
   ```

4. **Open Add Stream dialog**
   ```js
   const addBtn = Array.from(document.querySelectorAll("button"))
     .find(b => /add stream/i.test(b.textContent));
   addBtn?.click();
   ```

5. **Verify dialog opened**
   ```js
   /Add Stream to Layout/i.test(document.body.innerText)
   ```

6. **Screenshot** → `multistream.png`.

## Pass criteria
- [ ] Toolbar present with "MultiStream" label.
- [ ] Focus Layout button is disabled when no streams.
- [ ] Add-Stream dialog opens.
