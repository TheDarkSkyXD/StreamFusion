# Clip dialog playbook

## Goal
Confirm clip cards open an in-page dialog. There is intentionally no `/clip/...`
page route.

## Steps

1. **Navigate to a channel's Clips tab**
   ```js
   window.location.hash = "/stream/twitch/ninja?tab=clips";
   ```

2. **Click the first clip card**
   ```js
   const card = Array.from(document.querySelectorAll("[class*='cursor-pointer']"))
     .find((el) => /views/i.test(el.textContent || ""));
   card?.click();
   ```

3. **Verify the dialog opens**
   ```js
   /Viewing clip:|Playing Clip:/i.test(document.body.innerText);
   ```

4. **Verify we did not navigate to a clip page**
   ```js
   !window.location.hash.startsWith("#/clip/");
   ```

5. **Screenshot** -> `.scratch/images/clip-dialog.png`.

## Pass Criteria
- [ ] Clip dialog opens from a clip card.
- [ ] URL remains on the stream/search page; it does not become `/clip/...`.
