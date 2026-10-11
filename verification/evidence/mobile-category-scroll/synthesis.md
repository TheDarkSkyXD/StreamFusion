# Category grid decision

Choose candidate A. The existing refreshable FlatList owns row virtualization and paging events behind the same screen interface. Candidate B adds paired-row types, row keys, and projection modules without needing them for the existing two-column cards.

Graft candidate B's provider ID map into the memoized provider projection. Keep TanStack Query as the sole owner of pages and in-flight reads. Keep cursor exhaustion and cancellation behavior.

The independent cross-judge chose A. Its scores for bounded mounting, identity and concurrent paging, simplicity, search focus, and tests/style preservation were A 4/5/5/5/4 and B 5/4/2/2/3.

Search must remain mounted when its value changes. Reset the list offset through a ref instead of keying the list by the query. No recycler dependency or custom row model is needed.

The Model the Domain principle keeps pages in their existing typed query structure. The Laziness Protocol favors the existing list component. Prove It Works requires a production-component fixture and native evidence when reachable.
