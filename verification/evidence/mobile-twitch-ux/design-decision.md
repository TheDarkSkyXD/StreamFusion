# Mobile usability direction

Use Candidate A as the base. The independent judge recommended A because it preserves feature contracts and connects each change to an existing component. Candidate B offers useful ideas for reducing filter and tool clutter, but its six new shared APIs and navigation changes would expand this task before runtime evidence establishes a need.

The implementation will use existing rows, selectors, tabs, sheets, and cards. Settings selections should have one full-row touch target. Supporting row descriptions should be readable. Stream-card tags should not compete with channel identity. Category filters should leave content visible. Existing navigation state, provider contracts, and player lifetime remain authoritative.

Graft Candidate B's progressive disclosure only for a crowded path observed in StreamFusion. Keep its filter state in the existing feature component. Do not introduce a generic action registry, replace navigation, or hide settings behind a new search model.

Verification targets reachable routes, setting categories, sheet dismissal and selection, keyboard interactions, and enlarged fonts. Completed checks and gaps are recorded in README.md. Account-dependent provider writes and unavailable playback paths remain unverified. A screen that already works well needs inspection rather than a cosmetic edit.

Cross-judge was gpt-6-sol. Its criterion scores for A were 4, 3.5, 5, 4.5, and 4.5 out of 5 for evidence, breadth, contract safety, maintenance cost, and verifiability. B scored 3, 4, 2.5, 2, and 3. These are design judgments, not measured usability results.
