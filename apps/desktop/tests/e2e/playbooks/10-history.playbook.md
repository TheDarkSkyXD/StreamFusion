# History page playbook

## Goal
Confirm Watch History page mounts. If history is empty, the empty state shows; otherwise the items grid renders with clear-button enabled.

## Steps

1. **Navigate**
   ```js
   window.location.hash = "/history";
   ```

2. **Verify heading**
   ```js
   /Watch History/i.test(document.body.innerText)
   ```

3. **Branch on emptiness**
   ```js
   const isEmpty = /No watch history yet/i.test(document.body.innerText);
   const hasClear = Array.from(document.querySelectorAll("button"))
     .some(b => /Clear History/i.test(b.textContent));
   ({ isEmpty, hasClear })
   ```

4. **Screenshot** → `history.png`.

## Pass criteria
- [ ] Heading "Watch History" present.
- [ ] EITHER `isEmpty === true` AND no Clear button, OR `isEmpty === false` AND Clear button visible.
