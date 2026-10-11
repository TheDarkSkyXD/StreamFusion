# Mobile category scrolling verification

The production CategoriesScreen fixture has ten pages of 60 Twitch categories, an empty Kick catalog, and deterministic local search. It uses the real query hook and screen. Open `http://127.0.0.1:6007/?path=/story/android-discovery-categories-scroll--ready-infinite` after starting mobile Storybook.

The original ScrollView mounted every loaded card. Observed counts reached 120, 180, 240, 300, 360, and 600 loaded cards with matching mounted-card counts. The updated FlatList kept 18 cards mounted near the top with 600 categories loaded. Focused scroll operations automatically advanced to 120 and 180 categories, with 30 to 44 cards mounted at the sampled positions. These counts establish bounded mounting, not a measured frame-rate improvement.

Searching for Category 600 displayed that card, kept the search input focused, and reset scroll to zero. Switching to Kick displayed zero matches; switching back to Twitch restored the matching card.

Mobile verification passed the full test command, architecture import proof, lint, typecheck, formatting, and React Doctor. Seven focused tests cover the large grid and odd tail, loading and retained cards, provider identity, search focus and scroll reset, stable projections, and independent pagination while one provider is pending.

Native verification reached the original category screen. The shared emulator moved to a different screen during the scrolling attempt. An isolated API 35 emulator then started, but its development client remained on a blank launch screen. The isolated emulator was shut down. Native scrolling performance remains unverified. No native frame-rate comparison is claimed.

`baseline.json` and `after.json` record browser observations. `synthesis.md` records the chosen list design and principle decisions. Design and evidence files remain local; the production-component fixture and behavioral tests are part of the fix.

## Android 16 follow-up

The user clarified that this is a pre-release smoothness check on Android 16, not a report of stutter after installing the fix. No release was started.

The isolated `SF_HomePiP_API36_20261006` emulator on port 5582 reports Android 16. Its development client loaded the production CategoriesScreen and useCategoryCatalog from commit `1311a56`, with the existing deterministic story transport. `android16-bootstrap.patch` records the isolated route bootstrap, translation initialization, and safe-area/background wrapper. These bootstrap changes are not production changes.

Native swipes advanced past 100 categories. `android16-paged.png` and `android16-paged.xml` show categories 101 through 108. The initial transport page contains only 60 categories, so reaching 101 proves automatic next-page loading on Android. The recorded initial gesture attempt is `categories-android16.mp4`.

Ten further swipes reached categories 129 through 136, shown in `android16-next-page.png` and its XML. This crosses the second page boundary at 120. Both inspected screenshots contain populated rows. They do not establish frame cadence or absence of transient blank rows during a fling.

Smoothness remains inconclusive. The guest displayed both "Process system isn't responding" and "System UI isn't responding" before category interaction. The host had several other emulators running; these were left untouched. The first boot used host graphics and 3 GiB RAM. A second boot used software graphics, two virtual cores, and 2 GiB RAM. The app is a development client, and screen recording adds work. `android16-gfxinfo.txt` is diagnostic evidence from this environment, includes startup work, and must not be reported as release performance or a before/after improvement.

The fixture also omits artwork and uses uniform short titles with one provider. It cannot qualify image decoding, long titles, or merged Twitch/Kick page reordering.

Before release sign-off, install the candidate release APK on an Android 16 handset and test the live Categories screen with artwork. Browse past 100 and 300 categories, fling in both directions, and cross several page boundaries. Confirm the visible category stays in place when data arrives, the viewport does not go blank, and the list does not develop repeated hitches as it grows. Repeat with All, Twitch, and Kick, then search, clear search, change language, and refresh. Capture the build identifier, phone model, refresh rate, recording, and a trace restricted to the scrolling interval. A browser mounting count or an emulator development-client run is not a release smoothness pass.
