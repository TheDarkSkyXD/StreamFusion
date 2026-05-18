/**
 * U24 — Engagement tab shell.
 *
 * Two sections today: Predictions (U25) and Polls (U26). Giveaways arrives in
 * U27. The tab is rendered only for the Twitch broadcaster (gated by U19's
 * visibility logic in TwitchChat) — components here assume the current user
 * IS the broadcaster of `channelId`.
 *
 * Each section owns its own polling loop. The polling hook (useHelixPoll)
 * pauses while the window is in the background so this tab doesn't burn
 * tokens when the user is elsewhere.
 */

import { EngagementPolls } from "./EngagementPolls";
import { EngagementPredictions } from "./EngagementPredictions";

export interface EngagementTabProps {
  channelId: string;
}

export function EngagementTab({ channelId }: EngagementTabProps) {
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <EngagementPredictions channelId={channelId} />
      <EngagementPolls channelId={channelId} />
      {/* U27 will add EngagementGiveaways here. */}
    </div>
  );
}
