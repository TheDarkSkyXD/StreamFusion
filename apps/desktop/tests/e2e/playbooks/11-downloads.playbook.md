# Downloads page playbook

## Goal
Confirm Downloads page renders heading and the (currently placeholder) Active + Completed sections.

## Steps

1. **Navigate**
   ```js
   window.location.hash = "/downloads";
   ```

2. **Verify heading and section labels**
   ```js
   const t = document.body.innerText;
   ({
     hasHeading: /Downloads/i.test(t),
     hasActive: /Active Downloads/i.test(t),
     hasCompleted: /Completed/i.test(t),
   })
   ```

3. **Verify at least one mock item is visible** (until real downloads land — they will replace these):
   ```js
   /Epic Win Moment|Full Stream VOD|Funny Fail Compilation/.test(document.body.innerText)
   ```

4. **Screenshot** → `downloads.png`.

## Pass criteria
- [ ] Heading and both sections render.
- [ ] At least one placeholder item is visible.

## Notes
This page currently uses hard-coded `MOCK_DOWNLOADS`. When real downloads ship, replace the placeholder-item assertion with an actual download-store query.
