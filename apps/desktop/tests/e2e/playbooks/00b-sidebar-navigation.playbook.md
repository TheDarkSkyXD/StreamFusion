# Sidebar navigation playbook

## Goal
Confirm the sidebar links navigate between the major pages (Home, Following, Categories, History, Downloads, MultiStream) and that each lands on the expected route + renders a heading or sentinel.

## Preconditions
- Dev build running via `npm run dev:mcp`.
- StreamFusion project registered with `debug-electron-mcp`.

## Steps

For each row in the table below:

1. Click the sidebar link (or fall back to hash navigation if the click selector is unstable).
2. Wait for the page sentinel to appear.
3. Take a screenshot named per `Screenshot`.

| Order | Sidebar label | Hash route fallback | Sentinel (visible text or selector) | Screenshot |
|------:|---------------|---------------------|--------------------------------------|------------|
| 1 | "Home" | `#/` | Text "Browse All Categories" | `nav-01-home.png` |
| 2 | "Following" | `#/following` | Heading matching `/following/i` | `nav-02-following.png` |
| 3 | "Categories" | `#/categories` | Heading matching `/categories/i` | `nav-03-categories.png` |
| 4 | "History" | `#/history` | Heading matching `/watch history/i` | `nav-04-history.png` |
| 5 | "Downloads" | `#/downloads` | Heading matching `/downloads/i` | `nav-05-downloads.png` |
| 6 | "MultiStream" | `#/multistream` | Button with name `/add stream/i` | `nav-06-multistream.png` |

### Click-first navigation (preferred)

```js
// Replace the label per row.
(() => {
  const link = Array.from(document.querySelectorAll('a, [role="link"], button'))
    .find((el) => el.textContent?.trim() === 'Following');
  if (!link) return { clicked: false, reason: 'link-not-found' };
  link.click();
  return { clicked: true };
})()
```

### Hash fallback (use only if click fails)

```js
// Replace the route per row.
window.location.hash = '#/following';
true
```

### Sentinel poll

```js
// Text sentinel
document.body.innerText.includes('Browse All Categories')

// Heading sentinel
!!Array.from(document.querySelectorAll('h1,h2,h3'))
  .find((h) => /following/i.test(h.textContent ?? ''))
```

Poll for up to ~10 seconds per page. Capture the screenshot once the sentinel passes.

## Pass criteria
- [ ] All 6 navigations land on a page where the sentinel is present.
- [ ] All 6 screenshots saved.
- [ ] Renderer logs since the playbook started contain no uncaught exceptions.
