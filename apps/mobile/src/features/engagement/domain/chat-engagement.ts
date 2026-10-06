import type { ChatDisplayPreferences } from "@mobile/features/settings/capabilities/chat-display-settings";
import type {
  ChannelPoll,
  ChannelPrediction,
} from "../capabilities/engagement";
import type { EngagementSnapshot } from "./engagement-controller";

export type ActiveChatEngagement = {
  readonly polls: readonly ChannelPoll[];
  readonly predictions: readonly ChannelPrediction[];
};

export function activeChatEngagement(
  snapshot: EngagementSnapshot,
  display: Pick<ChatDisplayPreferences, "showPolls" | "showPredictions">,
): ActiveChatEngagement {
  return {
    polls: display.showPolls
      ? snapshot.polls.filter((poll) => poll.status === "ACTIVE")
      : [],
    predictions: display.showPredictions
      ? snapshot.predictions.filter(
          (prediction) =>
            prediction.status === "ACTIVE" || prediction.status === "LOCKED",
        )
      : [],
  };
}
