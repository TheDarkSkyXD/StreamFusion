# Slice 01 - Platform-managed signed-in FollowButton

Status: done

## Parent

PRD: ../prd.md

## What to build

Make the FollowButton honor the account-follow contract for both Platforms: when a user is signed in to the Channel's Platform, StreamFusion does not create or remove account Follows locally. Instead, the button opens the Channel on the Platform site so the user can perform the canonical follow or unfollow there. Guest Follow behavior remains local and unchanged.

This slice should remove the current asymmetry where signed-in Kick follows are platform-managed but signed-in Twitch follows can still be written locally. After this slice, signed-in Follow and Unfollow both route to the Platform for Twitch and Kick; StreamFusion catches up later through account sync.

## Acceptance criteria

- [x] Given the user is signed in to Twitch and is not following a Twitch Channel, clicking Follow opens that Channel on twitch.tv and does not call the local follow-add path.
- [x] Given the user is signed in to Kick and is not following a Kick Channel, clicking Follow opens that Channel on kick.com and does not call the local follow-add path.
- [x] Given the user is following a Twitch account-source row, clicking Unfollow opens that Channel on twitch.tv and does not remove the local row directly.
- [x] Given the user is following a Kick account-source row, clicking Unfollow opens that Channel on kick.com and does not remove the local row directly.
- [x] Given the user is signed out of the Channel's Platform, Follow and Unfollow continue to create/remove Guest Follows locally.
- [x] Guest Follows remain separate after sign-in and are not promoted to account Follows.
- [x] Button title/toast copy reflects platform-managed behavior for both Twitch and Kick.
- [x] Unit tests cover signed-in Twitch, signed-in Kick, account-source unfollow, and signed-out Guest Follow behavior.

## Blocked by

None - can start immediately

## Comments

- Closed 2026-07-02: signed-in Twitch follow now routes to twitch.tv like Kick, while guest/source-local behavior remains local. Verified by focused FollowButton tests and the follow-sync focused regression sweep.
