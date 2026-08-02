# Kick follow writes use the authenticated web session

Kick's official Public API does not currently expose viewer follow/unfollow writes, but StreamFusion's signed-in Kick Follow and Unfollow controls should still perform real account writes from inside the app. We will use the authenticated `kick.com` web session against Kick's internal follow/unfollow surface, then run follow sync to confirm the account state before showing the final followed/unfollowed state; pending writes retry with a bounded backoff because this surface is more brittle than a documented API.
