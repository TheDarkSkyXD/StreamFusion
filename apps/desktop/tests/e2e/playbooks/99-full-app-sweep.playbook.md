# Full-app sweep playbook

## Goal
Walk every page in sequence and capture a screenshot for each. Useful after large refactors — one big "did anything regress visually?" pass.

## Steps

For each of the routes below:

1. Set `window.location.hash` to the route.
2. Wait ~400ms.
3. Capture renderer logs since the previous step.
4. Take a screenshot named after the route.

| Order | Route | Screenshot |
|------:|-------|------------|
| 1 | `/` | `sweep-01-home.png` |
| 2 | `/following` | `sweep-02-following.png` |
| 3 | `/categories` | `sweep-03-categories.png` |
| 4 | `/categories/twitch/509658` | `sweep-04-category-detail.png` |
| 5 | `/search?q=ninja` | `sweep-05-search.png` |
| 6 | `/stream/twitch/ninja` | `sweep-06-stream.png` |
| 7 | `/video/twitch/vod-sweep?title=Sweep%20VOD&channelName=ninja` | `sweep-07-video.png` |
| 8 | `/multistream` | `sweep-08-multistream.png` |
| 9 | `/history` | `sweep-09-history.png` |
| 10 | `/downloads` | `sweep-10-downloads.png` |
| 11 | `/settings` | `sweep-11-settings.png` |

## Pass criteria
- [ ] All 11 routes mount with no JS exceptions in renderer logs.
- [ ] 11 screenshots saved.
