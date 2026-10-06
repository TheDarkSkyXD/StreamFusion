import { useEffect, useSyncExternalStore } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { MobileButton } from "@mobile/design/button";
import { MobileProgress } from "@mobile/design/feedback";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import type { ModerationChannel } from "@mobile/features/moderation/capabilities/moderation";
import type { ChatDisplaySettingsSession } from "@mobile/features/settings/capabilities/chat-display-settings";
import type {
  PredictionSettingsSession,
  PredictionStyle,
} from "@mobile/features/settings/capabilities/prediction-settings";
import type {
  ChannelPoll,
  ChannelPrediction,
  EngagementChoice,
} from "../capabilities/engagement";
import type { EngagementController } from "../domain/engagement-controller";
import { activeChatEngagement } from "../domain/chat-engagement";

export type ChatEngagementInlineProps = {
  readonly channel: ModerationChannel;
  readonly controller: EngagementController;
  readonly displaySession: ChatDisplaySettingsSession;
  readonly predictionSession: PredictionSettingsSession;
  readonly onOpenProvider: (channel: ModerationChannel) => void;
};
export type ChatEngagementInlineRuntime = Pick<
  ChatEngagementInlineProps,
  "controller" | "displaySession" | "predictionSession"
>;
export type ChatEngagementInlineBindings = ChatEngagementInlineRuntime &
  Pick<ChatEngagementInlineProps, "onOpenProvider">;

export function ChatEngagementInline({
  channel,
  controller,
  displaySession,
  predictionSession,
  onOpenProvider,
}: ChatEngagementInlineProps) {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const display = useSyncExternalStore(
    displaySession.subscribe,
    displaySession.peek,
    displaySession.peek,
  ).preferences;
  const predictionStyle = useSyncExternalStore(
    predictionSession.subscribe,
    predictionSession.peek,
    predictionSession.peek,
  ).preferences.style;
  const enabled = display.showPolls || display.showPredictions;
  useEffect(() => {
    void displaySession.load();
    void predictionSession.load();
  }, [displaySession, predictionSession]);
  useEffect(() => {
    if (enabled) {
      void controller.open(channel, {
        polls: display.showPolls,
        predictions: display.showPredictions,
      });
    } else {
      controller.cancel();
    }
    return () => controller.cancel();
  }, [
    controller,
    enabled,
    display.showPolls,
    display.showPredictions,
    channel,
  ]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") controller.cancel();
      else if (enabled)
        void controller.open(channel, {
          polls: display.showPolls,
          predictions: display.showPredictions,
        });
    });
    return () => listener.remove();
  }, [
    controller,
    enabled,
    display.showPolls,
    display.showPredictions,
    channel,
  ]);
  if (!enabled) return null;
  const matches =
    snapshot.channel?.id === channel.id &&
    snapshot.channel.platform === channel.platform;
  if (!matches || snapshot.authority !== "broadcaster") return null;
  const active = activeChatEngagement(snapshot, display);
  if (active.polls.length === 0 && active.predictions.length === 0) return null;
  return (
    <View style={styles.stack} testID="chat-engagement-inline">
      {active.polls.map((poll) => (
        <PollCard
          key={poll.id}
          poll={poll}
          onOpenProvider={() => onOpenProvider(channel)}
        />
      ))}
      {active.predictions.map((prediction) => (
        <PredictionCard
          key={prediction.id}
          prediction={prediction}
          style={predictionStyle}
          onOpenProvider={() => onOpenProvider(channel)}
        />
      ))}
    </View>
  );
}

function PollCard({
  poll,
  onOpenProvider,
}: {
  readonly poll: ChannelPoll;
  readonly onOpenProvider: () => void;
}) {
  return (
    <View style={styles.card} testID={`chat-poll-${poll.id}`}>
      <Text style={mobileType.label}>LIVE POLL</Text>
      <Text style={mobileType.title}>{poll.title}</Text>
      <Choices choices={poll.choices} countLabel="votes" />
      <MobileButton
        accessibilityLabel={`Vote in ${poll.title} on Twitch`}
        onPress={onOpenProvider}
        testID={`chat-poll-vote-${poll.id}`}
        variant="secondary"
      >
        Vote on Twitch
      </MobileButton>
    </View>
  );
}

function PredictionCard({
  prediction,
  style,
  onOpenProvider,
}: {
  readonly prediction: ChannelPrediction;
  readonly style: PredictionStyle;
  readonly onOpenProvider: () => void;
}) {
  return (
    <View
      style={[
        styles.card,
        style === "native" ? styles.nativePrediction : styles.unifiedPrediction,
      ]}
      testID={`chat-prediction-${prediction.id}`}
    >
      <Text style={mobileType.label}>
        {style === "native" ? "TWITCH PREDICTION" : "PREDICTION"} ·{" "}
        {prediction.status === "LOCKED" ? "LOCKED" : "LIVE"}
      </Text>
      <Text style={mobileType.title}>{prediction.title}</Text>
      <Choices choices={prediction.outcomes} countLabel="participants" />
      <MobileButton
        accessibilityLabel={`Open ${prediction.title} on Twitch`}
        onPress={onOpenProvider}
        testID={`chat-prediction-open-${prediction.id}`}
        variant="secondary"
      >
        {prediction.status === "LOCKED"
          ? "View on Twitch"
          : "Predict on Twitch"}
      </MobileButton>
    </View>
  );
}

function Choices({
  choices,
  countLabel,
}: {
  readonly choices: readonly EngagementChoice[];
  readonly countLabel: string;
}) {
  const total = choices.reduce((sum, choice) => sum + choice.votes, 0);
  return (
    <View style={styles.choices}>
      {choices.map((choice) => (
        <View key={choice.id}>
          <Text style={mobileType.body}>
            {choice.title} · {choice.votes} {countLabel}
          </Text>
          <MobileProgress
            label={`${choice.title} share`}
            value={total > 0 ? choice.votes / total : 0}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: mobileSpacing.small, paddingBottom: mobileSpacing.small },
  card: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  choices: { gap: mobileSpacing.small },
  nativePrediction: { borderColor: mobileColors.twitch },
  unifiedPrediction: { borderColor: mobileColors.border },
});
